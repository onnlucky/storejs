// a file backend, it writes the log, and can read the log in on startup
// TODO add posibility of doing stuff synchronously

var fs = require("fs");

function FileBackend(db) {
    if (!(this instanceof FileBackend)) return new FileBackend(db);

    var Store = db.Store;
    var self = this;

    this.load = function load(dir, prefill, cb) {
        var buf = "";
        var root = null;
        var input = fs.createReadStream("data.db", { encoding: 'binary', flags: 'r' });
        input.on('error', function(err) {
            if (err.errno == process.ENOENT) {
                root = Store.import(null, prefill);
                self.openlog();
                return cb(root);
            }
            throw new Error("unable to load: "+ err);
        });
        input.on('end', function() {
            if (root == null) {
                root = Store.import(null, prefill);
                self.openlog();
                return cb(root);
            }
            db.fetchlog(); // replay part of log is not interesting
            self.openlog();
            cb(root);
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

        return;
        cb(Store.import(null, prefill));
    }

    var output = null;
    var queue = [];

    this.openlog = function() {
        output = fs.createWriteStream("data.db", { flags: 'a', encoding: 'bindary' });
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

