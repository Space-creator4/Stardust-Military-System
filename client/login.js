const button = document.getElementById("discordLogin");
const status = document.getElementById("loginStatus");
const countryInput = document.getElementById("countryCode");
const countryList = document.getElementById("countryCodesList");

const params = new URLSearchParams(window.location.search);
const error = params.get("error");

if (error === "invalid_country") {
    status.textContent = "INVALID COUNTRY CODE — PLEASE TRY AGAIN.";
} else if (error === "country_required") {
    status.textContent = "COUNTRY CODE REQUIRED — ASK YOUR UNIT LEADER.";
} else if (error) {
    status.textContent = "LOGIN FAILED — PLEASE TRY AGAIN.";
}

fetch(window.stardustApi("/api/country-codes"))
    .then(response => response.json())
    .then(data => {
        if (
            countryList &&
            data &&
            Array.isArray(data.codes)
        ) {
            data.codes.forEach(code => {
                const option = document.createElement("option");
                option.value = code.code;
                option.textContent =
                    (code.label || "") +
                    (code.label ? " — " : "") +
                    code.code;
                countryList.appendChild(option);
            });
        }
    })
    .catch(() => {
        /* keep quiet on transient network errors */
    });

countryInput.addEventListener("input", () => {
    countryInput.value =
        countryInput.value.toUpperCase();
});

button.addEventListener("click", () => {
    const code =
        countryInput
            ? countryInput.value.trim().toUpperCase()
            : "";

    status.textContent = "CONNECTING TO DISCORD...";

    const base = window.stardustApi("/auth/discord");

    window.location.href =
        base +
        (code
            ? (base.includes("?") ? "&" : "?") +
              "country=" +
              encodeURIComponent(code)
            : "");
});