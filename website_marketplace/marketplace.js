const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const config = require("../configuration.js");
const axios = require("axios");
const logger = require("../logger.js");
const marketplaceAddr = config.marketplaceAddr;

const db = new sqlite3.Database('./website_marketplace/db/keys.db', async (err) => {
  if (err) {
    logger.error(err.message);
  }
  logger.log('Connected to the keys database.');
  
  try {
    await createUnspentKeysTable();
    await createUserKeysTable();
    await createPendingPurchasesTable();
  } catch (error) {
    logger.error("Error creating tables:", error);
  }
});

// create necessary tables if they don't exist
async function createPendingPurchasesTable(){
    return new Promise((resolve, reject) => {
        db.run("CREATE TABLE IF NOT EXISTS pending_purchases (token TEXT PRIMARY KEY, tx TEXT, created DATIME DEFAULT CURRENT_TIMESTAMP);", (err) => {
            if (err){
                reject(err);
            }
            else{
                resolve();
            }
        });
    });

}

async function createUserKeysTable() {
    return new Promise((resolve, reject) => {
        db.run("CREATE TABLE IF NOT EXISTS keys (token TEXT PRIMARY KEY, address TEXT, key TEXT, epoch TEXT, created DATETIME DEFAULT CURRENT_TIMESTAMP);", (err) => {
        if (err) {
            reject(err);
        } else {
            resolve();
        }
        });
    });
}

async function createUnspentKeysTable() {
    return new Promise((resolve, reject) => {
        db.run("CREATE TABLE IF NOT EXISTS unspent_keys (key TEXT PRIMARY KEY, epoch TEXT);", (err) => {
        if (err) {
            reject(err);
        } else {
            resolve();
        }
        });
    });

}

// clear pending purchases that are old
setInterval(async () => {
    logger.log("Clearing pending purchases");
    db.run("DELETE FROM keys WHERE key = 'Pending' AND created < DATETIME('now', '-15 minute');", (err) => {
        if (err){
            logger.error("Error deleting pending keys:", err);
        }
    });
}, 15 * 60 * 1000); // 15  mins

// pending purchase checking loop
let intervalID;
let pendingPurchases;
let submittedTxs;
(async () => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    pendingPurchases = await getPendingTokens();
    submittedTxs = await getSubmittedTx();
    logger.log("Pending purchases: ", pendingPurchases);
    logger.log("Submitted transactions: ", submittedTxs);
    intervalID = startChecking();
})();

function startChecking(){
    return setInterval(async () => {
        logger.log("Checking purchases");
        
        await checkPendingPurchases().catch((err) => {
            logger.error("Error checking pending purchases:", err);
            isChecking = false;
        });

        if (submittedTxs.length == 0 && intervalID){
            clearInterval(intervalID);
            isChecking = false;
            intervalID = undefined;
            return;
        }
    }, 25000);
}

// get tx by token
function getTx(token){
    return new Promise((resolve, reject) => {
        db.get("SELECT tx, created FROM pending_purchases WHERE token = ?;", [token], (err, row) => {
            if (err){
            return reject(err);
            }
            const tx = row ? row.tx : undefined;
            const created = row ? row.created : undefined;
            resolve({"txHash": tx, "created": created});
        });
    });

}

// check if the amount of a tx is correct
async function checkAmount(tx){
    const identityStatus = await axios.post(config.node.url, {
            jsonrpc: "2.0",
            method: "dna_identity",
            params: [tx.from],
            id: 1,
            key: config.node.key
        }).then((response) => {
            return response.data.result.state;
        }).catch((error) => {
            logger.error("Error checking identity status:", error);
            return undefined;
        });

    if (identityStatus == "Verified")
        return tx.amount == 1.5;
    else if (identityStatus == "Human")
        return tx.amount == 2.5;

    return tx.amount == 5;
}

// check if the comment of a tx is correct
function checkComment(tx, token){
    let payload = tx.payload.slice(2);
    // convert hex to string
    try{
        payload = Buffer.from(payload, 'hex').toString('utf8');
    }
    catch (e){
        logger.error("Error decoding payload:", e);
        return false;
    }
    return payload == token;
}

async function checkPendingPurchases(){
    for (var i = submittedTxs.length - 1; i >= 0; i--){
        var token = submittedTxs[i];
        const { txHash, created } = await getTx(token);

        if (txHash == undefined){
            logger.log("TX not submitted", token); // this should not happen ?
        }

        // delete if tx is too old
        if (new Date(created + 'Z') < new Date(Date.now() - 15 * 60 * 1000)){   // 15 mins
            logger.log("TX expired", token);
            pendingPurchases.splice(i, 1);
            submittedTxs.splice(submittedTxs.indexOf(token), 1);
            await db.run("DELETE FROM pending_purchases WHERE token = ?;", [token], (err) => {
                if (err){
                    logger.error("Error deleting purchase:", err);
                }
            });
            await db.run("DELETE FROM keys WHERE token = ? AND key = 'Pending';", [token], (err) => {
                if (err){
                    logger.error("Error deleting key:", err);
                }
            });
            continue;
        }

        // get tx info from node
        const tx = await axios.post(config.node.url, {
                jsonrpc: "2.0",
                method: "bcn_transaction",
                params: [txHash],
                id: 1,
                key: config.node.key
            }).then((response) => {
                return response.data.result;
            }).catch((error) => {
                logger.error("Error checking transaction:", error);
                return undefined;
            });
        
        if (!tx){
            logger.log("TX NOT FOUND", token);
            continue;
        }

        if (tx.timestamp != 0){
            // tx is mined
            if (tx.to != marketplaceAddr.toLowerCase() || !checkAmount(tx) || !checkComment(tx, token)){
                continue;
            }

            // get current epoch
            let currentEpoch = await axios.post(config.node.url, {
                jsonrpc: "2.0",
                method: "dna_epoch",
                params: [],
                id: 1,
                key: config.node.key
            }).then((response) => {
                return response.data.result.epoch;
            });

            // obtain api key
            db.run("BEGIN EXCLUSIVE TRANSACTION;");
            let apiKey = await getUnspentApiKey(currentEpoch);

            // assign api key to user
            try {
            logger.log("Assigning key:", apiKey, "FOR TOKEN", token);

                await db.run("DELETE FROM pending_purchases WHERE token = ?;", [token]);
                await db.run("UPDATE keys SET key = ?, epoch = ? WHERE token = ?;", [apiKey, currentEpoch, token]);
        
                await db.run("COMMIT");
            } catch (err) {
                await db.run("ROLLBACK");
                logger.error("Error during transaction:", err);
                }
        }
    }
}

function getUnspentApiKey(currentEpoch){
    // preferrably ran inside an exclusive transaction
    return new Promise((resolve, reject) => db.get("SELECT key FROM unspent_keys WHERE epoch = ? LIMIT 1;", [currentEpoch], (err, row) => {
        if (err){
            reject(err);
            return;
        }
        if (row == undefined){
            reject(err);
            return;
        }

        let apiKey = row ? row.key : null;
        db.run("DELETE FROM unspent_keys WHERE key = ?;", [apiKey], (err) => {
            if (err){
                reject(err);
            }
        });

        resolve(apiKey);
    }));
}

async function getPendingTokens(){
    // delete old pending purchases
    await db.run("DELETE FROM keys WHERE key = 'Pending' AND created < DATETIME('now', '-15 minute');", (err) => {
        if (err){
            logger.error("Error deleting pending keys:", err);
        }
    });

    return new Promise((resolve, reject) => {
        db.all("SELECT token FROM keys WHERE key = 'Pending';", (err, rows) => {
            if (err){
                return reject(err);
            }
            let tokens = [];
            rows.forEach((row) => {
                tokens.push(row.token);
            });
            resolve(tokens);
        });
    });
}

function getSubmittedTx(){
    return new Promise((resolve, reject) => {
        db.all("SELECT token FROM pending_purchases;", (err, rows) => {
            if (err){
                return reject(err);
            }
            let tokens = [];
            rows.forEach((row) => {
                tokens.push(row.token);
            });
            resolve(tokens);
        });
    });

}

async function beginPurchase(address){
    if (!address){
        return;
    }

    // get current epoch
    let currentEpoch = await axios.post(config.node.url, {
        jsonrpc: "2.0",
        method: "dna_epoch",
        params: [],
        id: 1,
        key: config.node.key
    }).then((response) => {
        return response.data.result.epoch;
    }).catch((error) => {
        logger.error("Error getting epoch:", error);
        return undefined;
    });

    // check if there are unspent keys available
    let unspentKeys = await new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM unspent_keys WHERE epoch = ?;", [currentEpoch], (err, row) => {
            if (err){
                reject(err);
            }
            let count = row ? row.count : 0;
            resolve(count);
        });
    });
    unspentKeys -= pendingPurchases.length;
    logger.log("Unspent keys remaining:", unspentKeys);

    if (unspentKeys < 1){
        return ("no keys");
    }

    // get user key count
    const keyCount = await new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM keys WHERE address = ? AND epoch = ?;", [address, currentEpoch], (err, row) => {
            if (err){
                reject(err);
            }
            let count = row ? row.count : 0;
            resolve(count);
        });
    });

    // check address status
    const status = await axios.post(config.node.url, {
        jsonrpc: "2.0",
        method: "dna_identity",
        params: [address],
        id: 1,
        key: config.node.key
    }).then((response) => {
        return response.data.result.state;
    }).catch((error) => {
        logger.error("Error checking identity status:", error);
        return undefined;
    });

    if (keyCount >= 3 || status == "Newbie" && keyCount >= 1){
        return ("too many keys");
    }

    if (status == "Newbie"){
        // give free key
        let apiKey;
        db.run("BEGIN EXCLUSIVE TRANSACTION;");
        try{
            apiKey = await getUnspentApiKey(currentEpoch);
        }
        catch (err){
            await db.run("ROLLBACK");
            logger.error("Error during free key assignment:", err);
            return err;
        }

        return new Promise((resolve, reject) => {
            const token = uuidv4();
            db.run("INSERT INTO keys (token, address, key, epoch) VALUES (?, ?, ?, ?);", [token, address, apiKey, currentEpoch], (err) => {
                if (err){
                    db.run("ROLLBACK");
                    reject(err);
                }
                else{
                    logger.log("Free key assigned to:", address);
                    db.run("COMMIT");
                    resolve("free");
                }
            });
        });
    }

    return new Promise((resolve, reject) => {
        const token = uuidv4();
        db.run("INSERT INTO keys (token, address, key) VALUES (?, ?, ?);", [token, address, "Pending"], (err) => {
            if (err){
                reject(err);
            }
            else{
                pendingPurchases.push(token);
                logger.log("Purchase started:", token);
                resolve(token);
            }
        });
    })
}

function txSubmit(token, txHash){
    return new Promise((resolve, reject) => {
        if (!txHash){
            return reject("TX hash error");
        }
        if (!pendingPurchases.includes(token)){
            return reject("pendingPurchase does not include token");
        }
        db.run("INSERT INTO pending_purchases (token, tx) VALUES (?, ?);", [token, txHash], (err) => {
            if (err){
                reject(err);
            }
            else{
                submittedTxs.push(token);
                if (!intervalID)
                    intervalID = startChecking();
                logger.log("TX submitted for token:", token, "\n  TX:", txHash, "\n");
                resolve(true);
            }
        });
    });

}

function getKeys(address){
    return new Promise((resolve, reject) => {
        db.all("SELECT token, key, epoch FROM keys WHERE address = ?;", [address], (err, rows) => {
            if (err){
                reject(err);
            }
            let keys = [];
            rows.forEach((row) => {
                keys.push({"key": row.key, "epoch": row.epoch});
            });
            resolve(keys);
        });
    });
}

module.exports = {
    beginPurchase,
    txSubmit,
    getKeys
}