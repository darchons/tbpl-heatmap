#!/usr/bin/env node
// vim: set ft=javascript ts=2 sts=2 sw=2 et tw=80:

if (process.argv.length < 4) {
  console.log('Usage: ' + [
      process.argv[0], process.argv[1], '<out>', '<in>', '[<in> [...]]'
    ].join(' '));
  process.exit(1);
}

var brain = require('brain');
var fs = require('fs');
var q = require('q');
var data = [];
var outfile = process.argv[2];

process.argv.slice(3).map(function(infile) {
  return function() {
    return q.nfcall(fs.readFile, infile).then(function(input) {
      return JSON.parse(input);
    });
  };

}).reduce(q.when, q()).then(function(data_array) {
  return data_array.reduce(function(prev, cur) {
    return prev.concat(cur);
  }, []);

}).then(function(data) {
  var net = new brain.NeuralNetwork({
    hiddenLayers: [200, 200, 200]
  });

  // Count number of unique inputs/outputs.
  var input = {}, output = {};
  data.forEach(function(datum) {
    Object.keys(datum.input).forEach(function(name) {
      input[name] = true;
    });
    Object.keys(datum.output).forEach(function(name) {
      output[name] = true;
    });
  });

  console.log("Training " + data.length + " sets");
  console.log("mapping " + Object.keys(input).length + " inputs to " +
              Object.keys(output).length + " outputs");

  net.train(data, {
    log: true
  });
  return net.toJSON();

}).then(function(output) {
  return q.nfcall(fs.writeFile, outfile, JSON.stringify(output, null, 2));

}).done();
