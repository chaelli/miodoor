const config = require('./config.json');
const path = require('path');
const fs = require('fs');
const log4js = require('log4js');
const cv = require('customvision-api');
const nodemailer = require('nodemailer');
const piFastGpio = require('pi-fast-gpio');
const request = require('request');
const debounce = require('debounce');
const {spawn} = require('child_process');
const fkill = require('fkill');
const servos = config.servos;
const keepDoorClosedFor = config.keepDoorClosedFor || 1*60*1000; // 1 minute
let reopenTimeout = null;
let gpioReady = false;
let stopProcessing = true;
let subprocess = null;

// start python server
function startPythonScript(firstTime = false) {
    if (!firstTime) {
        if (stopProcessing) {
            logger.info('currently restarting python process');
        }
        else {
            stopProcessing = true;
            logger.info('killing python process');
            fkill('python3', {force: true, ignoreCase: true}).then(() => {
                logger.info('killed python process');

                // give it a few seconds before restart
                setTimeout(() => {
                    logger.info('starting python script');
                    subprocess = spawn('python3', [config.pythonScript]);
                    // give it a few seconds to start
                    setTimeout(() => {
                        stopProcessing = false;
                    }, 10000);
                }, 10000);
            }).catch((e) => {
                // probably already killed
                // restart
                logger.info('fkill error was ' + e);
                logger.info('starting python script');
                subprocess = spawn('python3', [config.pythonScript]);
                stopProcessing = false;
            });
        }
    }
    else {
        logger.info('starting python script');
        subprocess = spawn('python3', [config.pythonScript]);
        stopProcessing = false;
    }
}

// helper function to read custom vision api data
function getValueForTag(data, tagName) {
    return data.predictions.find((o) => o.tagName.toLowerCase() === tagName.toLowerCase());
}

// helper function to move servo
function moveServo(servo, pulseWith, keepMotorRunning) {
    clearInterval(servo.gpioInterval);
    clearTimeout(servo.gpioStopTimeout);
    servo.gpioInterval = setInterval(function() {
        gpio.setServoPulsewidth(servo.id, pulseWith);
    }, 20);
    if (!keepMotorRunning) {
        servo.gpioStopTimeout = setTimeout(function() {
            gpio.setServoPulsewidth(servo.id, 0);
            clearInterval(servo.gpioInterval);
        }, 500)
    }
}

// helper function to close door
function closeDoor() {
    clearTimeout(reopenTimeout);
    reopenTimeout = setTimeout(function() {
        openDoor();
    }, keepDoorClosedFor);
    config.servos.forEach(s => moveServo(s, s.closedState, true));
}

// helper function to open door
function openDoor() {
    clearTimeout(reopenTimeout);
    config.servos.forEach(s => moveServo(s, s.openState, false));
}

// sends mail when door was closed
function sendMail(imagePath, closeDateStr, timeTaken, mouseValue, callback) {
    try {
        mailTransporter.sendMail({
            from: config.emailAccount,
            to: config.notificationEmail,
            subject: 'Mio door closed at ' + closeDateStr + ' rated ' + mouseValue,
            text: 'Mio door closed at ' + closeDateStr + ' because of image ' + imagePath + ' after ' + timeTaken + '. Mouse rating was ' + mouseValue,
            attachments: [
            {
                path: imagePath
            }]
        }, (err, info) => {
            if (err) {
                logger.error(`Mail could not be sent: ${JSON.stringify(err)}`);
            }
            callback(true);
        });
    }
    catch (e) {
        logger.error(`Error while sending mail: ${e}`);
        callback(false);
    }
}

function localCallback(name, imagePath, timeTaken, catValue, mouseValue) {
    logger.info(`${name}: cat = ${catValue}, mouse = ${mouseValue}, time taken = ${timeTaken}`);
    if (/*catValue > 0.7 && */mouseValue > 0.5) {
        let closeDateStr = new Date().toString();
        logger.info(`${name}: close the door at ${closeDateStr} after  ${timeTaken}ms`);
        closeDoor();

        // send async - save performance for servo
        setTimeout(function() {
            sendMail(imagePath, closeDateStr, timeTaken, mouseValue, () => {
                config.deleteCatFiles ? deleteFile(imagePath) : archiveFile(imagePath, name);
            });
        }, 5000);
    } else if (catValue > 0.5) {
        config.deleteCatFiles ? deleteFile(imagePath) : archiveFile(imagePath, name);
    } else {
        deleteFile(imagePath);
    }
}


function handleNewFile(name) {
    const path = `${config.imageDir}/${name}`;
    if (stopProcessing) {
        logger.info('processing stopped');
        return;
    }

    // new image created
    let timeTracker = new Date().valueOf();

    const options = {
        url: config.localService.address,
        body: path,
        headers: {"content-length": path.length}
    };

    request.post(options, (err, httpResponse, body) => {
        if (err) {
            logger.error('an error occured when doing local request 1: ' + err);
            if (err.toString().indexOf('Error: connect ECONNREFUSED') != -1 || err.toString().indexOf('Error: connect ETIMEDOUT') != -1 || err.toString().indexOf('Error: socket hang up') != -1) {
                startPythonScript();
            }
            deleteFile(path);
        }
        else if (httpResponse.statusCode == 429) {
            logger.error('Too many requests on image recognition');
        }
        else {
            let timeTaken = new Date().valueOf() - timeTracker;
            if (body.indexOf('{') === 0) {
                let response = JSON.parse(body);
                localCallback(name, path, timeTaken, Math.max(response.tags.nomouse, response.tags.mouse), response.tags.mouse);
            }
            else {
                logger.error('an error occured when doing local request 2: ' + body);
                deleteFile(path);
            }
        }
    });
        
}

function deleteFile(path) {
    if (config.deleteFiles) {
        fs.unlink(path, () => { logger.info(`${path}: deleted file`); });
    }
}

function archiveFile(path, fileName) {
    logger.info(`${path}: archived file`)
    fs.rename(path, `${config.archiveDir}/${fileName}`);
}


// INITIALIZE
// initialize logging
log4js.configure({
    appenders: { file: { type: 'dateFile', filename: config.logFile, pattern: '.yyyy-MM-dd', compress: true }, console: { type: 'console' } },
    categories: { default: { appenders: ['file', 'console'], level: 'trace' } }
});
const logger = log4js.getLogger();

logger.info('startup');

// initialize mail sending
let smtpConfig = {
    service: 'gmail',
    auth: {
        user: config.emailAccount,
        pass: config.emailPassword
    }
};
let mailTransporter = nodemailer.createTransport(smtpConfig);
// verify connection configuration
mailTransporter.verify(function(error, success) {
    if (error) {
        logger.error('Error when verifing mail sender', error);
    } else {
        logger.info('Mailserver is ready to send messages');
    }
});

// start python script
startPythonScript(true);

// exit & error handler
subprocess.on('exit', () => {
  logger.warn('Need to restart python script');
  startPythonScript();
});
subprocess.stdout.on('data', (data) => {
  logger.info(`Python Log: ${data}`);
});
subprocess.stderr.on('data', (data) => {
  logger.info(`Python Log: ${data}`);
});

// initialize servo access
const gpio = new piFastGpio();
gpio.connect("127.0.0.1", "8888", function(err) {
    if (err) throw err;
    gpioReady = true;

    // make sure we close the connection when the script ends
    process.on('exit', code => {
        config.servos.forEach(s => gpio.setServoPulsewidth(s.id, 0));
        gpio.close();
        logger.info('closed connection to gpio');

        subprocess.kill()
        logger.info('python script stopped');
                
        process.exit(code);
    });

    // Catch CTRL+C
    process.on('SIGINT', () => { process.exit(0); });

    // Catch uncaught exception
    process.on('uncaughtException', err => { logger.error(`uncaught exception: ${err}`); process.exit(1); });
});

// initially - open the door
openDoor();

// watch directory and react on new images
let handleNewFileDebounced = debounce(handleNewFile, 20, true);
fs.watch(config.imageDir, { recursive: false }, function(evt, name) { if (evt == 'change') { handleNewFileDebounced(name); }} );

logger.info('startup finished');
