import './views/theme-toggle';
import { ApplicationServiceProvider } from './services/application-service-provider';
import { Logger } from './services/logger-service';

const message: string = "Hello World";

const appDiv = document.getElementById('app');
if (appDiv) {
    appDiv.innerHTML = `<h1>${message}</h1>`;
}

const logger = ApplicationServiceProvider.getService(Logger);
logger?.LogInfo("Index script loaded.", "Index", "Scripting"); 