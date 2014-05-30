#!/usr/bin/env node
// vim: set ft=javascript ts=2 sts=2 sw=2 et tw=80:

if (process.argv.length != 6) {
  console.log('Usage: ' + [
      process.argv[0], process.argv[1], '<remote>', '<start>', '<end>', '<out>'
    ].join(' '));
  process.exit(1);
}

var fs = require('fs');
var q = require('q');
var request = require('request');

var remote = process.argv[2].replace(/\/?$/, '');
var repo = /\/([^\/]+)$/.exec(remote)[1];
var pushlog_url = remote + '/json-pushes';
var builds_url = 'http://tbpl.mozilla.org/php/getRevisionBuilds.php';
var start = process.argv[3];
var end = process.argv[4];
var outfile = process.argv[5];

function do_request(options) {
  var deferred = q.defer();
  request(options, function(error, response, body) {
    if (error) {
      deferred.reject(error);
    } else if (response.statusCode !== 200) {
      deferred.reject(new Error('Bad status: ' + request.statusCode));
    } else {
      deferred.resolve(body);
    }
  });
  return deferred.promise;
}

// Match valid commit messages
var commit_msg_regexp = /(bug|b=)\s*\d{4,}/i;
// Match valid revision numbers
var rev_regexp = /[0-9a-fA-F]{10,}/;

var results = {};

function aggregateFiles(push) {
  var files = {};
  push.changesets.forEach(function(cset) {
    cset.files.forEach(function(file) {
      files[file.slice(0, file.lastIndexOf('/') + 1)] |= 1;
    });
  });
  return files;
}

function process_pushes(pushes) {
  // Process each push in pushes sequentially.
  return pushes.map(function(push) {
    // Return a function that produces a promise.
    return function() {

      var last_cset = push.changesets[push.changesets.length - 1];
      var rev = last_cset.node.substr(0, 12);
      return do_request({
        url: builds_url,
        qs: {
          branch: repo,
          rev: rev
        },
        json: true

      }).then(function(builds) {
        builds.forEach(function(build) {
          var builder = build.buildername.replace(repo, '').replace('  ', ' ');

          if (!build.notes.some(function(note) {
            // A rev in the note means the changeset was backed out.
            var backouts = note.note.trim().match(rev_regexp);
            if (backouts) {
              backouts.forEach(function(backout) {
                backout = backout.substr(0, 12);
                results[backout] = results[backout] || {};
                results[backout][builder] = 1;
              });
              return true;
            }
            return false;

          }) && build.result.trim().toLowerCase() === 'success') {
            results[rev] = results[rev] || {};
            results[rev][builder] = 0;
          }
        });

        // Delay 10s before the next network request.
        return q.delay(10000);
      });
    };

  // Run the functions sequentially
  }).reduce(q.when, q());
}

do_request({
  url: pushlog_url,
  qs: {
    full: '1',
    startID: start,
    endID: end
  },
  json: true

}).then(function(pushes) {
  var all_pushes = Object.keys(pushes).filter(function(id) {
    // Only count changesets corresponding to actual bugs.
    var push = pushes[id];
    var last_cset = push.changesets[push.changesets.length - 1];
    return last_cset.desc.trim().search(commit_msg_regexp) > -1;
  }).map(function(id) {
    return pushes[id];
  });

  var requests = [];
  var chunk = Math.ceil(all_pushes.length / 10);
  for (var i = 0; i < all_pushes.length; i += chunk) {
    requests.push(process_pushes(all_pushes.slice(i, i + chunk)));
  }
  return q.all(requests).then(function() {
    var csets = {};
    Object.keys(pushes).forEach(function(id) {
      var push = pushes[id];
      var last_cset = push.changesets[push.changesets.length - 1];
      csets[last_cset.node.substr(0, 12)] = push;
    });
    return [csets, results];
  });

}).spread(function(csets, results) {
  var output = Object.keys(results).filter(function(cset) {
    if (cset in csets) {
      return true;
    }
    console.log('Warning: changeset ' + cset + ' not found!');
    return false;
  }).map(function(cset) {
    return {
      input: aggregateFiles(csets[cset]),
      output: results[cset]
    };
  });
  return q.nfcall(fs.writeFile, outfile, JSON.stringify(output, null, 2));

}).done();
