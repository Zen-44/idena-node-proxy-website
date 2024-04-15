const SITE_URL = "https://marketplace.idena.cloud";

// Your existing code
function beginAuth(){
    // make a get request to /auth/get-token to get a token

    fetch('/auth/get-token')
        .then(response => response.json())
        .then(data => {
            const token = data.token;
            const URL = "https://app.idena.io/dna/signin?token=" + token + 
                "&callback_url=" + SITE_URL +  
                "&nonce_endpoint=" + SITE_URL + "/auth/start-session" + 
                "&authentication_endpoint=" + SITE_URL + "/auth/authenticate"
                "&favicon_url=" + SITE_URL + "/resources/favicon.ico";

            // redirect user
            window.location.href = URL;
        })
        .catch(error => {
            console.error('Error:', error);
        });
}