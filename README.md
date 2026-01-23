# AWS Account Label Helper

A Microsoft Edge browser extension that automatically labels AWS account license plates with friendly product names on the BC Gov AWS SSO portal.

## Features

- **Automatic Labeling**: Displays product names next to AWS account license plates (e.g., "b0ec6c-dev" → shows "BC Parks Data Register")
- **Customizable Mappings**: Add, edit, and delete license plate mappings through an easy-to-use popup interface
- **Real-time Updates**: Labels update automatically when mappings are changed
- **Persistent Storage**: Mappings are saved using Chrome sync storage and persist across sessions

## Quick Install

**Latest Release**: [Download and install the latest version](https://github.com/digitalspace/bcgov-access-portal/releases/latest)

1. Click the link above
2. Download the `.zip` file from the Assets section
3. Extract the ZIP file to a folder
4. Follow the manual installation steps below

## Manual Installation

1. Open Microsoft Edge browser
2. Navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in the bottom-left corner)
4. Click **Load unpacked**
5. Select the `bcgov-access-portal` folder
6. The extension icon should appear in your toolbar

## Usage

### Viewing Labels

1. Navigate to `https://bcgov.awsapps.com/start/#/?tab=accounts`
2. Labels will automatically appear next to recognized license plates

### Managing Mappings

1. Click the extension icon in your toolbar to open the popup
2. View all current license plate → product name mappings
3. To add a new mapping:
   - Enter the license plate code (e.g., "b0ec6c")
   - Enter the product name (e.g., "BC Parks Data Register")
   - Click "Add"
4. To delete a mapping, click the "×" button next to it
5. Changes apply immediately to any open AWS portal tabs

## Default Mappings

The extension comes pre-configured with these mappings:

- `b0ec6c` → BC Parks Data Register
- `b74067` → BC Parks Backcountry Reservations
- `fac0b6` → BC Parks Attendance and Revenue Reporting
- `fad511` → Day Use Pass Reservations
- `pil3ei` → Day Use Pass Reservations

## File Structure

```
bcgov-access-portal/
├── manifest.json          # Extension configuration
├── content.js            # Content script for DOM manipulation
├── popup.html            # Popup UI for managing mappings
├── popup.js              # Popup logic
├── styles.css            # Label styling
├── mapping.json          # Default mappings
├── icons/                # Extension icons (add your own)
└── README.md             # This file
```



## Technical Details

- **Manifest Version**: 3 (latest standard)
- **Permissions**: 
  - `storage` - for saving user mappings
  - `activeTab` - for accessing the AWS portal page
- **Content Script**: Runs on `https://bcgov.awsapps.com/start/*`
- **Storage**: Uses `chrome.storage.sync` for cross-device synchronization

## Development

The content script uses a MutationObserver to detect dynamically loaded content and apply labels automatically. Labels are styled with CSS and inserted directly into the DOM next to license plate text.

## Troubleshooting

- **Labels not appearing**: Refresh the AWS portal page after installing the extension
- **Mappings not saving**: Check that the extension has proper storage permissions
- **Incorrect labels**: Verify the license plate code is correct in the popup manager

## License

This extension is for internal BC Gov use.
