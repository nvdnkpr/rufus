/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const util = require('util');

const jshint = require('jshint').JSHINT;
const walk = require('walk');

// read jshintrc
var jshintrc = JSON.parse(fs.readFileSync(path.join(__dirname, '../.jshintrc'))
    .toString());
var filesToLint = [];

var options = {
  listeners: {
    file: function(root, fStat, next) {
      var f = path.join(root, fStat.name);
      if (/\.js$/.test(f)) {
        filesToLint.push(f);
      }
      next();
    }
  }
};

module.exports = {



  'jshint': {

    'before': function(done) {
      var w = walk.walkSync(path.join(__dirname, '../lib'));
      w.on('file', options.listeners.file);
      w = walk.walkSync(__dirname);
      w.on('file', options.listeners.file);
      w.once('end', done);
    },

    'should yield no errors': function(done) {
      var errors = [];

      function checkNext() {
        if (!filesToLint.length) {
          if (errors.length) {
            var buf = util.format("\n        %d errors:\n        * ",
                                  errors.length);
            buf += errors.join("\n        * ");
            done(buf);
          } else {
            done(null);
          }
          return;
        }
        var f = filesToLint.shift();
        fs.readFile(f.toString(), function(err, data) {
          // now
          f = path.relative(process.cwd(), f);
          if (!jshint(data.toString(), jshintrc)) {
            jshint.errors.forEach(function(e) {
              errors.push(
                util.format("%s %s:%d - %s", e.id, f, e.line, e.reason));
            });
          }
          checkNext();
        });
      }
      checkNext();
    }

  }
};

