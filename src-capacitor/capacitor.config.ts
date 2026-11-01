import { defineCapacitorConfig } from '@quasar/app-vite/capacitor';

export default defineCapacitorConfig({
  "appId": "bio.mourn.mobile",
  "appName": "Mourn",
  "webDir": "www",
  "server": {
    "androidScheme": "https",
    "iosScheme": "https"
  },
  "android": {
    "allowMixedContent": false,
    "captureInput": false,
    "minWebViewVersion": 90,
    "appendUserAgent": "MournMobile"
  },
  "ios": {
    "appendUserAgent": "MournMobile",
    "contentInset": "never",
    "allowsLinkPreview": false,
    "scrollEnabled": true
  },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 0,
      "launchAutoHide": true,
      "backgroundColor": "#000000",
      "showSpinner": false
    },
    "Keyboard": {
      "resize": "body"
    },
    "PushNotifications": {
      "presentationOptions": [
        "badge",
        "sound",
        "alert"
      ]
    }
  }
});
