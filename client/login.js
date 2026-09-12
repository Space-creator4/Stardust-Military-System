const button = document.getElementById("discordLogin");
const status = document.getElementById("loginStatus");

button.addEventListener("click", () => {
    status.textContent = "CONNECTING TO DISCORD...";

    window.location.href = "/auth/discord";
});