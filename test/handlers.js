/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const assert = require('assert');
const EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const os = require('os');
const path = require('path');

const Q = require('q');

const rufus = require('../');

const NOW = Date.now();
var counter = 1;
function tmp() {
  return path.join(os.tmpDir(),
      'rufus-' + NOW + '-' + process.pid + '-' + (counter++));
}


function bytes(x) {
  var b = new Buffer(x);
  b[0] = '<'.charCodeAt(0);
  b[b.length - 1] = '>'.charCodeAt(0);
  b.fill('a', 1, b.length - 1);
  return b.toString();
}

module.exports = {
  'Handler': {
    'constructor': {
      'should accept options': function() {
        var h = new rufus.Handler({ level: rufus.ERROR });
        assert.equal(h.level, rufus.ERROR);
      },
      'should accept a level': function() {
        var h = new rufus.Handler(rufus.WARN);
        assert.equal(h.level, rufus.WARN);
      }
    },
    'handle': {
      'requires emit to accept a callback argument': function() {
        var h = new rufus.Handler();
        h.emit = function(){};

        assert.throws(h.handle.bind(h), function(err) {
          return err.message === 'Handler.emit requires a callback argument';
        });

        h = new rufus.Handler();
        h.emit = function(record, callback){
          record = callback;
        };
        assert.doesNotThrow(h.handle.bind(h));
      },
      'should use filters on record': function(done) {
        var h = new rufus.Handler();
        var lastRecord;
        h.emit = function(record, callback){
          lastRecord = record;
          callback();
        };

        h.addFilter(new rufus.Filter('foo'));
        h.handle({ name: 'foo' }).then(function() {
          assert.equal(lastRecord.name, 'foo');

          return h.handle({ name: 'foobar' });
        }).then(function() {
          assert.notEqual(lastRecord.name, 'foobar');
        }).done(done);
      },
      'should timeout if taking too long': function(done) {
        var h = new rufus.Handler({ timeout: 10 });
        h.emit = function(record, callback) {
          record = callback;
          // never call callback, so it should timeout
        };

        h.handle({ message: 'foo' }).then(function() {
          assert(false); // shouldn't be called
        }, function(reason) {
          assert(reason);
        }).done(done);
      }
    },
    'emit': {
      'must be overriden by subclasses': function() {
        var h = new rufus.Handler();
        assert.throws(h.emit);
      }
    }
  },
  'Stream': {
    'constructor': {
      'should accept options': function() {
        var stream = {};
        var handler = new rufus.handlers.Stream({
          level: rufus.INFO,
          stream: stream
        });

        assert.equal(handler.level, rufus.INFO);
        assert.equal(handler._stream, stream);
      },
      'should accept just a stream': function() {
        var stream = {};
        var handler = new rufus.handlers.Stream(stream);

        assert.equal(handler.level, rufus.NOTSET);
        assert.equal(handler._stream, stream);
      }
    },
    'emit': {
      'should write message to stream': function(done) {
        var out;
        var stream = {
          write: function(msg, fn) {
            out = msg;
            fn();
          }
        };

        var handler = new rufus.handlers.Stream({
          stream: stream,
          formatter: new rufus.Formatter('%message%n')
        });
        handler.handle({ message: 'foo' }).then(function() {
          assert.equal(out, 'foo\n');
          done();
        });
      },
      'should wait for flush on slow streams': function(done) {
        var out;
        var stream = new EventEmitter();
        stream.write = function write(data, fn) {
          setTimeout(function() {
            out = data;
            fn();
          }, 1);
        };
        var handler = new rufus.handlers.Stream({
          stream: stream,
          formatter: new rufus.Formatter('%message%n')
        });
        handler.handle({ message: 'secret' }).then(function() {
          assert.equal(out, 'secret\n');
        }).done(done);
      }
    }
  },
  'File': {
    'constructor': {
      'should accept options': function() {
        var filename = tmp();
        var handler = new rufus.handlers.File({
          level: rufus.WARN,
          file: filename
        });

        assert.equal(handler.level, rufus.WARN);
        assert.equal(handler._file, filename);
      },
      'should accept a filename': function() {
        var filename = tmp();
        var handler = new rufus.handlers.File(filename);

        assert.equal(handler._file, filename);
      }
    },
    'handle': {
      'should write to the file': function(done) {
        var filename = tmp();
        var handler = new rufus.handlers.File({
          file: filename,
          formatter: new rufus.Formatter('%message%n')
        });
        handler.handle({ message: 'recon' }).then(function() {
          fs.readFile(filename, function(err, contents) {
            assert.ifError(err);
            assert.equal(contents.toString(), 'recon\n');
            done();
          });
        }).done();
      }
    }
  },
  'Console': {
    'constructor': {
      'should use stdout and stderr': function() {
        var h = new rufus.handlers.Console();
        assert.equal(h._out._stream, process.stdout);
        assert.equal(h._err._stream, process.stderr);
      }
    },
    'handle': {
      'should send low priority messages to stdout': function(done) {
        var h = new rufus.handlers.Console({
          formatter: new rufus.Formatter('%message%n'),
          colorize: false
        });
        var val;
        h._out._stream = {
          write: function(out, callback) {
            val = out;
            callback();
            return true;
          }
        };

        h.handle({ level: rufus.INFO, message: 'oscar mike' }).then(function() {
          assert.equal(val, 'oscar mike\n');
        }).done(done);
      },
      'should send warn and higher messages to stderr': function(done) {
        var h = new rufus.handlers.Console({
          formatter: new rufus.Formatter('%message%n'),
          colorize: false
        });
        var val;
        h._err._stream = {
          write: function(out, callback) {
            val = out;
            callback();
            return true;
          }
        };

        h.handle({ level: rufus.WARN, message: 'mayday' }).then(function() {
          assert.equal(val, 'mayday\n');
        }).done(done);
      }
    }
  },
  'RotatingFileHandler': {
    'handle': {
      'with maxSize should create new files': function(done) {
        this.timeout(5000);

        var filename = tmp();
        var handler = new rufus.handlers.Rotating({
          file: filename,
          maxSize: 64,
          formatter: new rufus.Formatter('%message%n')
        });

        assert.equal(handler._file, filename);
        handler.handle({ message: bytes(60) });
        handler.handle({ message: bytes(50) });
        handler.handle({ message: bytes(45) }).then(function() {
          assert.equal(fs.statSync(filename).size, 46);
          assert.equal(fs.statSync(filename + '.1').size, 51);
          assert.equal(fs.statSync(filename + '.2').size, 61);
        }).done(done);
      },
      'with maxFiles should not create more than max': function(done) {
        this.timeout(5000);

        var filename = tmp();
        var handler = new rufus.handlers.Rotating({
          file: filename,
          maxSize: 64,
          maxFiles: 3,
          formatter: new rufus.Formatter('%message%n')
        });

        handler.handle({ message: bytes(50) });
        handler.handle({ message: bytes(55) });
        handler.handle({ message: bytes(60) });
        handler.handle({ message: bytes(45) }).then(function() {
          assert.equal(fs.statSync(filename).size, 46);
          assert.equal(fs.statSync(filename + '.1').size, 61);
          assert.equal(fs.statSync(filename + '.2').size, 56);
          assert(!fs.existsSync(filename + '.3'));
        }).done(done);
      }
    }
  }
};
