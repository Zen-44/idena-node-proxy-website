window.addEventListener("load", function() {
    document.addEventListener("click", function(event) {
        var menu = document.getElementById("menu");
        var dropdown = document.getElementById("mainMenuDropdown");
        var isClickInsideMenu = dropdown.contains(event.target);
    
        if (!isClickInsideMenu) {
            // The click was outside the menu, close it.
            menu.checked = false;
        }
    });
});