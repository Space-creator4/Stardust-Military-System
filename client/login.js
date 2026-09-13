const button = document.getElementById("discordLogin");
const status = document.getElementById("loginStatus");

const params = new URLSearchParams(window.location.search);

if (params.get("error")) {
    status.textContent = "LOGIN FAILED — PLEASE TRY AGAIN.";
}

button.addEventListener("click", () => {
    status.textContent = "CONNECTING TO DISCORD...";

    window.location.href =
        window.stardustApi("/auth/discord");
});