import CacheStorage from "../../src/CacheStorage.js";
import ProfilePictureFetcher from "../../src/ProfilePictureFetcher.js";
import Author from "../../src/Author.js";
import SettingsManager from "../SettingsManager.js";

const cacheSizeElement = document.getElementById("cacheSize");
const clearCacheButton = document.getElementById("clearCache");
const inboxListCheckbox = document.getElementById("inboxList");
const contactsIntegrationCheckbox = document.getElementById(
  "contactsIntegration"
);
const emailInput = document.getElementById("email");
const fetchButton = document.getElementById("fetchButton");
const profilePictureDiv = document.getElementById("profilePicture");
const cache = new CacheStorage();
const settingsManager = new SettingsManager(cache);

async function printCacheSize(domElement) {
  const detailedSize = await cache.formattedSize();
  const iconsCount = detailedSize.iconsCount;
  const size = detailedSize.size;
  let iconsText;
  if (iconsCount === 0) {
    iconsText = " (" + browser.i18n.getMessage("noIcons") + ")";
  } else if (iconsCount === 1) {
    iconsText = " (" + browser.i18n.getMessage("oneIcon") + ")";
  } else {
    iconsText = " (" + browser.i18n.getMessage("multipleIcons", iconsCount) + ")";
  }
  domElement.textContent = size + iconsText;
}

async function clearCache() {
  await cache.clearCache();
  await printCacheSize(cacheSizeElement);
  clearCacheButton.disabled = true;
  clearCacheButton.textContent = browser.i18n.getMessage("cacheCleared");
}

function initOptions() {
  settingsManager.getInboxListEnabled().then((inboxListEnabled) => {
    inboxListCheckbox.checked = inboxListEnabled;
  });

  settingsManager.getContactsIntegrationEnabled().then((contactsIntegrationEnabled) => {
    contactsIntegrationCheckbox.checked = contactsIntegrationEnabled;
  });
}

function setInboxList() {
  settingsManager.setInboxListEnabled(inboxListCheckbox.checked);
  browser.runtime.sendMessage({ action: "refreshSettings" });
}

function setContactsIntegration() {
  settingsManager.setContactsIntegrationEnabled(contactsIntegrationCheckbox.checked);
  browser.runtime.sendMessage({ action: "refreshSettings" });
}

/**
 * Gets the Thunderbird version number
 * @returns {Promise<number>} - The major version number of Thunderbird
 */
async function getThunderbirdVersion() {
  try {
    const info = await browser.runtime.getBrowserInfo();
    const majorVersion = parseInt(info.version.split('.')[0], 10);
    return majorVersion;
  } catch (error) {
    console.error("Error getting Thunderbird version:", error);
    // Default to a high version number to use canvas approach if detection fails
    return 145;
  }
}

async function fetchProfilePicture() {
  fetchButton.disabled = true;
  profilePictureDiv.setAttribute("aria-busy", "true");
  profilePictureDiv.style.display = "flex";

  while (profilePictureDiv.firstChild) {
    profilePictureDiv.removeChild(profilePictureDiv.firstChild);
  }

  const mail = await Author.fromAuthor(emailInput.value);
  const fetcher = new ProfilePictureFetcher(window, mail, "duckduckgo", true);
  const url = await fetcher.getAvatar();

  if (!url) {
    profilePictureDiv.textContent = browser.i18n.getMessage("profilePictureNotFound");
  } else {
    const tbVersion = await getThunderbirdVersion();
    const useCanvas = tbVersion === 145;

    if (useCanvas) {
      // TB 145: Use canvas to bypass CSP restrictions
      const canvas = document.createElement("canvas");
      canvas.width = 100;
      canvas.height = 100;
      canvas.style.borderRadius = "8px";
      profilePictureDiv.appendChild(canvas);

      try {
        // Decode data URL and draw to canvas without using img.src
        const matches = url.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          const mimeType = matches[1];
          const base64Data = matches[2];

          // Use window.atob for better compatibility
          const atobFn = window.atob || atob;
          const binaryString = atobFn(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const BlobConstructor = window.Blob || Blob;
          const blob = new BlobConstructor([bytes], { type: mimeType });
          const createImageBitmapFn = window.createImageBitmap || createImageBitmap;
          const imageBitmap = await createImageBitmapFn(blob);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(imageBitmap, 0, 0, 100, 100);
        }
      } catch (error) {
        console.error("Error drawing image:", error);
        profilePictureDiv.textContent = browser.i18n.getMessage("errorDisplayingImage");
      }
    } else {
      // TB < 145 and TB 146+: Use img element directly
      const img = document.createElement("img");
      img.src = url;
      img.width = 100;
      img.height = 100;
      profilePictureDiv.appendChild(img);
    }
  }
  fetchButton.disabled = false;
  profilePictureDiv.removeAttribute("aria-busy");
}

function setupLocalization() {
  for (let node of document.querySelectorAll("[data-l10n-id]")) {
    let l10nId = node.getAttribute("data-l10n-id");
    node.textContent = browser.i18n.getMessage(l10nId);
  }
  for (let node of document.querySelectorAll("[data-l10n-attr-placeholder]")) {
    let l10nId = node.getAttribute("data-l10n-attr-placeholder");
    node.setAttribute("placeholder", browser.i18n.getMessage(l10nId));
  }
  for (let node of document.querySelectorAll("[data-l10n-attr-title]")) {
    let l10nId = node.getAttribute("data-l10n-attr-title");
    node.setAttribute("title", browser.i18n.getMessage(l10nId));
  }
}

/**
 * Initialize the options page
 */
async function initialize() {
  await printCacheSize(cacheSizeElement);
  initOptions();
  clearCacheButton.addEventListener("click", clearCache);
  inboxListCheckbox.addEventListener("change", setInboxList);
  contactsIntegrationCheckbox.addEventListener("change", setContactsIntegration);
  fetchButton.addEventListener("click", fetchProfilePicture);
  setupLocalization();
}

initialize();
