import './theme-toggle';

const message: string = "Hello World";

const appDiv = document.getElementById('app');
if (appDiv) {
    appDiv.innerHTML = `<h1>${message}</h1>`;
}

console.log("Index script loaded."); // Example placeholder 