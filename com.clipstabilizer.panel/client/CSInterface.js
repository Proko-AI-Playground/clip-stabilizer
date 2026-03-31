/**
 * Minimal CSInterface wrapper for CEP extensions.
 * Wraps the __adobe_cep__ runtime object injected by the CEP host.
 */

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};

function CSInterface() {}

CSInterface.prototype.getSystemPath = function(pathType) {
    var path = window.__adobe_cep__.getSystemPath(pathType);
    return path;
};

CSInterface.prototype.evalScript = function(script, callback) {
    if (callback === null || callback === undefined) {
        callback = function() {};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getHostEnvironment = function() {
    var hostEnvironment = window.__adobe_cep__.getHostEnvironment();
    return JSON.parse(hostEnvironment);
};

CSInterface.prototype.addEventListener = function(type, listener, obj) {
    window.__adobe_cep__.addEventListener(type, listener, obj);
};

CSInterface.prototype.removeEventListener = function(type, listener, obj) {
    window.__adobe_cep__.removeEventListener(type, listener, obj);
};

CSInterface.prototype.requestOpenExtension = function(extensionId, params) {
    window.__adobe_cep__.requestOpenExtension(extensionId, params);
};

CSInterface.prototype.closeExtension = function() {
    window.__adobe_cep__.closeExtension();
};
