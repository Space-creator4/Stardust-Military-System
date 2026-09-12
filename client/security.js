(() => {
    const warning = () => {
        console.log(
            "%c⚠ STOP!",
            "color:#ff5555;font-size:32px;font-weight:900;"
        );

        console.log(
            "%cDO NOT PASTE ANYTHING INTO THIS CONSOLE.",
            "color:#ff5555;font-size:18px;font-weight:900;"
        );

        console.log(
            "%cPasting code here can give someone access to your discord account or allow someone to perform actions as you.",
            "color:#d16262;font-size:13px;font-weight:600;"
        );

        console.log(
            "%cIf someone tells you to paste code here, close the console.",
            "color:#aeb8bf;font-size:13px;"
        );

        console.log(
            "%cSTARDUST COMMAND NETWORK",
            "color:#62d18b;font-size:11px;font-weight:700;letter-spacing:2px;"
        );
    };

    warning();

    setInterval(warning, 1000);
})();