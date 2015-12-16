var spawn = require('child_process').spawn;
var mime = require('mime-types');
var fs = require('fs');
var uuid = require('node-uuid');

module.exports = convertDocument;
prepareListener();

function prepareListener() {
  console.log('UNO listener (libreoffice) will be spawned');
  var UNOConnection = 'socket,host=127.0.0.1,port=2002,tcpNoDelay=1;urp;StarOffice.ComponentContext';

  // imitation of unoconv:
  // https://github.com/dagwieers/unoconv/blob/master/unoconv#L806
  spawn('soffice', [
    '--headless',
    '--invisible',
    '--nocrashreport',
    '--nodefault',
    '--nofirststartwizard',
    '--nologo',
    '--norestore',
    '--accept=' + UNOConnection
  ]).on('exit', function(code) {
    console.warn('UNO listener exited (it should act as a daemon) with code ' + code);
    prepareListener();
  });
}

var queue = [];
var active = false;

function pushJob(job) {
  if (active) {
    queue.push(job);
  } else {
    doJob(job);
  }
}

function shiftJob() {
  var job = queue.shift();
  if (job) {
    doJob(job);
  }
}

var emptyDocRegxp = /Document is empty/;

function doJob(job) {
  console.log('Unoconv converter process a job from the queue', {
    outputExtension: job.outputExtension,
    tempPath: job.tempPath
  });

  active = true;
  var child = spawn('unoconv', [
    '--stdout',
    '--no-launch',
    '--format', job.outputExtension,
    job.tempPath
  ]);
  child.stdout.pipe(job.res);
  child.stdout.on('end', function() {
    console.log('Unoconv converter delete temp file ' + job.tempPath);
    fs.unlink(job.tempPath, function(err) {
      if (err) console.error('Unoconv converter failed to remove temp file', err.stack);
    });

    // Do we really always pass here when job is over ?
    active = false;
    shiftJob();
  });
  child.stderr.on('data', function(data) {
    var dataStr = data.toString();
    // An error is often reported by unoconv about empty document
    if (!dataStr.match(emptyDocRegxp)) {
      job.next(new Error(dataStr));
    }
  });
}

function convertDocument(req, res, next) {
  var inputType = req.get('content-type').split(';')[0];
  var outputType = req.get('accept').split(';')[0];
  var inputExtension = mime.extension(inputType);
  var outputExtension = mime.extension(outputType);

  var tempPath = '/tmp/' + uuid.v1() + '.' + inputExtension;
  var writeStream = fs.createWriteStream(tempPath);
  req.pipe(writeStream);
  console.log('Unoconv converter create temp file ' + tempPath);

  writeStream.on('error', function(err) {
    console.error('Unoconv converter failed to write temp file', err.stack);
    next(err);
  });

  writeStream.on('finish', function() {
    pushJob({
      res: res,
      next: next,
      outputExtension: outputExtension,
      tempPath: tempPath
    });
  });
}
