// a file backend, it writes the log, and can read the log in on startup
// license: MIT; see license.txt
// TODO add posibility of doing stuff synchronously
// TODO implement a blob representing a file
// TODO add way to start new journal by dumping current data as journal ...

var fs = require("fs");

function FileBackend(db) {
    if (!(this instanceof FileBackend)) return new FileBackend(db);

    var Store = db.Store;
    var self = this;

    this.load = function load(dir, prefill, cb) {
        var buf = "";
        var root = null;

        function done() {
            if (!root) root = Store.import(null, prefill);
            self.openlog();
            return cb(root);
        }

        // read the journal and replay it if possible
        var input = fs.createReadStream("data.db", { encoding: 'binary', flags: 'r' });
        input.on('error', function(err) {
            if (err.errno == process.ENOENT) return done();
            throw new Error("unable to load: "+ err);
        });
        input.on('end', function() {
            db.fetchlog(); // replay part of log is not interesting
            done();
        });
        input.on('data', function(chunk) {
            buf += chunk;
            var i = 0;
            var j = 0;
            while (i < buf.length) {
                j = buf.indexOf('\n', i);
                if (j < 0) break;
                var entry = buf.substring(i, j);
                var s = db.replay(entry);
                if (!root) root = s;

                i = j + 1;
            }
        });
    }

    var output = null;
    this.openlog = function() {
        output = fs.createWriteStream("data.db", { flags: 'a', encoding: 'binary' });
        this.writelog(db.fetchlog());

        output.on('error', function(err) {
            throw new Error(err);
        });
    }

    this.writelog = function writelog(log, sync, cb) {
        if (!log || log.length == 0) return;

        var data = log.join('');
        console.log("WRITING---:\n" + data +"----\n");
        output.write(data, encoding='binary');
        if (cb) cb();
    }
}

// export the interface if nodejs is used
if (typeof(exports) != "undefined") exports.FileBackend = FileBackend;

