const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const config = require("./configuration")
const path = require("path")
const axios = require("axios")
const app = express()
const auth = require("./website_marketplace/auth");
const cookieParser = require('cookie-parser');
const marketplace = require("./website_marketplace/marketplace");
const logger = require("./logger");

app.use(cors())
app.use(bodyParser.json({ limit: "2mb" }))

function handleErr(fn) {
  return function(req, res, next) {
    fn(req, res, next).catch(err => {
      logger.error(err);
      res.status(500).send("An internal error occurred!");
    });
  };
}

// WEBSITE -------------------------------------------------------------------------------
// website routes
const websiteDir = path.join(__dirname, 'website_marketplace');
const websiteResourcesDir = path.join(__dirname, 'website_marketplace/resources');
app.use(express.static(websiteResourcesDir));
app.use(cookieParser());

// do not cache
app.use(function(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// serve the marketplace
app.get("/", handleErr(async (req, res) => {
  const token = req.cookies.token;
  if (await auth.isLogged(token)) {
    const address = await auth.getAddress(token);
    res.status(200).sendFile(path.join(websiteDir, 'marketplace.html'));
  } else {
    res.status(200).sendFile(path.join(websiteDir, 'login_page.html'));
  }
}));

app.get("/get-token", handleErr(async (req, res) => {
  const token = req.cookies.token;
  if (await auth.isLogged(token)) {
    const address = await auth.getAddress(req.cookies.token);
    const purchaseToken = await marketplace.beginPurchase(address);
    if (purchaseToken)
      res.status(200).send({"token": purchaseToken});
    else
      res.status(500).send({"err": "Something went wrong!"});
  } else {
    res.status(200).sendFile(path.join(websiteDir, 'login_page.html'));
  }
}));

app.get("/submit", handleErr(async (req, res) => {
  const token = req.query.token;
  const txHash = req.query.tx;

  if (await marketplace.txSubmit(token, txHash) === true){
    res.status(500).send({
      "success": true,
      "url": "https://marketplace.idena.cloud"
    })
  }
  else{
    res.status(500).send({
      "success": false,
      "url": "https://marketplace.idena.cloud",
      "error": "Something went wrong!"
      })
  }
}));

app.get("/get-keys", handleErr(async (req, res) => {
  const token = req.cookies.token;
  if (await auth.isLogged(token)) {
    const address = await auth.getAddress(token);
    const response = await marketplace.getKeys(address);
    res.status(200).send(response);
  } else {
    res.status(404).send({"err": "Not logged in!"});
  }
}));


// Idena Auth -------------------

app.get("/auth/get-token", handleErr(async (req, res) => {
  // generate token and give cookie
  const tokenPair = await auth.generateTokenPair();

  res.cookie('token', tokenPair.cookieToken, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: true});  // might want to put secure to false for testing
  res.status(200).send({"token": tokenPair.token});
}));

app.post("/auth/start-session", handleErr(async (req, res) => {
  logger.log("Authentication started: \n", req.body);

  const nonce = await auth.generateNonce(req.body);
  const response = {
    "success": true,
    "data": {
      "nonce": nonce
    }
  };
  res.status(200).send(response);
}));

app.post("/auth/authenticate", handleErr(async (req, res) => {
  if (await auth.validateSig(req.body)) {
    logger.log("Authentication successful: \n", req.body, "\n");

    res.status(200).send({
      "success": true,
      "data": {
        "authenticated": true,
        "token": req.body.token
      }
    });
  } else {
    logger.log("Authentication failed: \n", req.body, "\n");

    res.status(200).send({
      "success": true,
      "data": {
        "authenticated": false
      }
    });
  }
}));

app.get("/auth/address", handleErr(async (req, res) => {
  const token = req.cookies.token;
  const address = await auth.getAddress(token);

  // get address status
  const status = await axios.post(config.node.url, {
    method: "dna_identity",
    params: [address],
    id: 1,
    key: config.node.key
  })
  .then((response) => {return response.data.result.state;})
  .catch(err => {
    logger.error(err);
    return "error";
  });

  res.status(200).send({"address": address, "status": status});
}));

app.post("/auth/logout", handleErr(async (req, res) => {
  const token = req.cookies.token;
  await auth.removeCookieToken(token);
  logger.log("Logged out: ", token);
  res.status(200).send({"success": true});
}));

app.listen(8001)