const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const { bufferToHex, ecrecover, fromRpcSig, keccak256, pubToAddress } = require('ethereumjs-util');
const logger = require("../logger.js");
const crypto = require('crypto');

const db = new sqlite3.Database('./website_marketplace/db/auth.db', async (err) => {
  if (err) {
    logger.error(err.message);
  }
  logger.log('Connected to the auth database.');
  
  try {
    await createPendingAuthTable();
    await createUsersTable();
  } catch (error) {
    logger.error("Error creating tables:", error);
  }
});

async function createPendingAuthTable() {
  return new Promise((resolve, reject) => {
    db.run("CREATE TABLE IF NOT EXISTS pending_auth (token TEXT PRIMARY KEY, address TEXT, nonce TEXT);", (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function createUsersTable() {
  return new Promise((resolve, reject) => {
    db.run("CREATE TABLE IF NOT EXISTS users (token TEXT PRIMARY KEY, cookieToken TEXT UNIQUE, address TEXT, expiration DATETIME DEFAULT CURRENT_TIMESTAMP);", (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function generateTokenPair(){
    const token = uuidv4();
    const cookieToken = uuidv4();

    return new Promise((resolve, reject) => {
        let expiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        db.run("INSERT INTO users (token, cookieToken, address, expiration) VALUES (?, ?, ?, ?);", [token, cookieToken, "", expiration.toISOString()], (err) => {
            if (err) {
                return reject(err);
            }
            return resolve({"token": token, "cookieToken": cookieToken});
        })
    });
}

function isLogged(token){
    if (token == undefined){
        return false;
    }
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE cookieToken = ?;", [token], (err, row) => {
            if (err) {
                reject(err);
            }
            resolve(row && row.address.length === 42 && new Date(row.expiration) > new Date());
        });
    });
}

function getAddress(token){
    return new Promise((resolve, reject) => {
        db.get("SELECT address FROM users WHERE cookieToken = ?;", [token], (err, row) => {
            if (err) {
                reject(err);
            }
            const addr = row ? row.address : null;
            resolve(addr);
        });
    });

}

function generateNonce(body){
    const nonce = "signin-" + crypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO pending_auth (token, address, nonce) VALUES (?, ?, ?);", [body.token, body.address, nonce], (err) => {
            if (err) {
                return reject(err);
            }
            resolve(nonce);
        });
    });
}

function getNonce(token){
    return new Promise((resolve, reject) => {
        db.get("SELECT nonce FROM pending_auth WHERE token = ?;", [token], (err, row) => {
            if (err) {
                reject(err.message);
            }
            const nonce = row ? row.nonce : "";
            resolve(nonce);
        });
    });
}

function getPendingAddress(token){
    return new Promise((resolve, reject) => {
        db.get("SELECT address FROM pending_auth WHERE token = ?;", [token], (err, row) => {
            if (err) {
                reject(err.message);
            }
            const addr = row ? row.address : "";
            resolve(addr);
        })
    });
}

async function validateSig(body){
    // get nonce from db
    const nonce = await getNonce(body.token);
    const address = await getPendingAddress(body.token);

    // validate signature
    const signature = body.signature;
    const nonceHash = keccak256(keccak256(Buffer.from(nonce, 'utf-8')));
    const { v, r, s } = fromRpcSig(signature);
    const pubKey = ecrecover(nonceHash, v, r, s);
    const addrBuf = pubToAddress(pubKey);
    const signatureAddress = bufferToHex(addrBuf);

    if (signatureAddress === address){
        // remove nonce from db
        await db.run("DELETE FROM pending_auth WHERE token = ?;", [body.token]);
        await db.run("UPDATE users SET address = ? WHERE token = ?;", [signatureAddress, body.token]);
    }

    return signatureAddress === address;
}

function removeCookieToken(token){
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM users WHERE cookieToken = ?;", [token], (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(true);
            }
        });
    });
}

module.exports = {
    generateNonce,
    validateSig,
    generateTokenPair,
    isLogged,
    getAddress,
    removeCookieToken
}