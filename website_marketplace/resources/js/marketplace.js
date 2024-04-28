const marketplaceAddr = "0xaF001b9348179964306cbbc600554602AEE6f85b";
const SITE_URL = "https://marketplace.idena.cloud";
const clipboardCopy = '<span class="clipboard-symbol" style="cursor: pointer;" onclick="copyToClipboard(event)"><span style="font-size: .875em; margin-right: .125em; position: relative; top: -.25em; left: -.125em">📄<span style="position: absolute; top: .25em; left: .25em">📄</span></span></span>';

var infoPressed = false;
window.onload = function() {
    document.addEventListener("click", function(event) {
        var menu = document.getElementById("avatarMenu");
        var dropdown = document.getElementById("avatarDropdown");
        var isClickInsideMenu = dropdown.contains(event.target);
    
        if (!isClickInsideMenu) {
            // The click was outside the menu, close it.
            menu.checked = false;
        }
    });

    document.addEventListener("click", function(event) {
        var infoBox = document.getElementById("info-box");
        var infoSymbol = document.getElementById("infoSymbol");
        var isClickInsideInfoBox = infoBox.contains(event.target) || infoSymbol.contains(event.target);
    
        if (!isClickInsideInfoBox) {
            // The click was outside the menu, close it.
            infoBox.style.display = "none";
            infoPressed = false;
        }
    });

    document.getElementById("logoutButton").addEventListener("click", function() {
        fetch('/auth/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(() => {
            location.reload(true);
        });
    });

    document.getElementById("infoSymbol").addEventListener("click", function() {
        if (!infoPressed){
            document.getElementById("info-box").style.display = "inline-block";
            infoPressed = true;
        }
        else{
            document.getElementById("info-box").style.display = "none";
            infoPressed = false;
        }
    });
};

fetch('/auth/address')
    .then(response => response.json())
    .then(data => {
        const userAddress = data.address;
        document.getElementById("avatar").src = "https://robohash.idena.io/" + userAddress;
        document.getElementById("userAddress").innerHTML = userAddress;
        document.getElementById("userAddress").href = "https://scan.idena.io/address/" + userAddress;
    })
    .catch(error => {
        console.error(error);
    });

fetch("/get-keys")
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        const tableBody = document.getElementById("userKeys");
        for (var i = data.keys.length - 1; i >= 0; i--){
            const key = data.keys[i].key
            const epoch = data.keys[i].epoch;
            const currentEpoch = data.currentEpoch;

            const tr = document.createElement("tr");
            const key_td = document.createElement("td");
            const epoch_td = document.createElement("td");

            key_td.className = "keyTd";
            epoch_td.textContent = epoch;

            if (key == "Pending"){
                key_td.style.fontStyle = "italic";
                key_td.innerHTML = key;
                epoch_td.textContent = "-";
            }
            else {
                if (epoch != currentEpoch)
                    key_td.innerHTML = "<s>" + key + "</s>";
                else key_td.innerHTML = key;
                key_td.innerHTML += clipboardCopy;
            }

            tr.appendChild(key_td);
            tr.appendChild(epoch_td);
            tableBody.appendChild(tr);
        }

        if (data.length == 0){
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 2;
            td.textContent = "No keys yet!";
            td.style.textAlign = "center";
            tr.appendChild(td);
            tableBody.appendChild(tr);
        }
    })
    .catch(error => {
        console.error(error);
    });

function copyToClipboard(event) {
    const textToCopy = event.target.closest('.keyTd').textContent.slice(0, -4);
    navigator.clipboard.writeText(textToCopy);
}

function purchaseKey(){
    fetch("/get-token")
        .then(response => response.json())
        .then(data => {
            const token = data.token;
            if (token == "free"){
                alert("Since you are a newbie, you received a free key!");
                location.reload(true);
                return;
            }
            else if (token == "too many keys"){
                alert("You reached the limit for discounted keys this epoch! If you have pending keys, please wait for them to be processed or discarded (15 minutes).");
                return;
            }
            else if (token == "no keys"){
                alert("There are currently no keys available for purchase. Please try again later.");
                return;
            }

            // get addr status
            fetch("/auth/address")
                .then(response => response.json())
                .then(data => data.status)
                .then(data => {
                    let price = 5;  // default
                    if (data == "Verified")
                        price = 1.5;
                    else if (data == "Human")
                        price = 2.5;

                    console.log("Price: ", price);

                    const txURL = "https://app.idena.io/dna/send?address=" + 
                           marketplaceAddr + "&amount=" + price + "&comment=" + token +
                           "&callback_url=" + SITE_URL + "/submit?token=" + token + 
                           "&callback_format=json";
                    console.log(txURL);
                    window.location.href = txURL;
                })
        })
}