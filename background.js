// AWS Account Label Helper - Background Service Worker
// Bridges content script <-> native messaging host for credential updates

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateCredentials') {
    chrome.runtime.sendNativeMessage(
      'com.bcgov.aws_credential_helper',
      {
        action: 'updateCredentials',
        credentialsBlock: message.credentialsBlock,
        targets: message.targets
      },
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          sendResponse(response);
        }
      }
    );
    return true; // keep channel open for async response
  }
});
