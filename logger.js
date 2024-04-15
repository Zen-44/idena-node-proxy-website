const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'site.log');

const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function getTimestamp() {
    const date = new Date();
    return `[${date.toLocaleString()}]`;
}

const log = function(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    const timestamp = getTimestamp();
    logStream.write(`${timestamp} ${message}\n`);
    console.log(`${timestamp} ${message}`);
};

const error = function(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    const timestamp = getTimestamp();
    logStream.write(`${timestamp} [ERROR] ${message}\n`);
    console.error(`${timestamp} [ERROR] ${message}`);
};

module.exports = {
    log,
    error
};