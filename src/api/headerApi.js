/**
 * Get the message window from a native tab (used for installation on message headers).
 *
 * @param {Object} nativeTab - The native tab object.
 * @returns {Object|null} - The message window or null if not found.
 */
function getMessageWindow(nativeTab) {
  if (nativeTab instanceof Ci.nsIDOMWindow) {
    return nativeTab.messageBrowser.contentWindow;
  } else if (nativeTab.mode && nativeTab.mode.name == "mail3PaneTab") {
    if (
      nativeTab.chromeBrowser.contentWindow.multiMessageBrowser &&
      !nativeTab.chromeBrowser.contentWindow.multiMessageBrowser.hidden
    ) {
      return nativeTab.chromeBrowser.contentWindow.multiMessageBrowser
        .contentWindow;
    }
    return nativeTab.chromeBrowser.contentWindow.messageBrowser.contentWindow;
  } else if (nativeTab.mode && nativeTab.mode.name == "mailMessageTab") {
    return nativeTab.chromeBrowser.contentWindow;
  } else if (nativeTab.browser && nativeTab.browser.contentWindow) {
    return nativeTab.browser.contentWindow;
  } else {
    return null;
  }
}

/**
 * Get the content window from a native tab (used for installation on inbox list).
 *
 * @param {Object} nativeTab - The native tab object.
 * @returns {Object|null} - The content window or null if not found.
 */
function getContentWindow(nativeTab) {
  if (nativeTab instanceof Ci.nsIDOMWindow) {
    return nativeTab.messageBrowser.contentWindow;
  } else if (
    nativeTab.mode &&
    (nativeTab.mode.name == "mail3PaneTab" ||
      nativeTab.mode.name == "mail3Pane")
  ) {
    return nativeTab.chromeBrowser.contentWindow;
  } else if (nativeTab.browser && nativeTab.browser.contentWindow) {
    return nativeTab.browser.contentWindow;
  } else {
    return nativeTab.browser.contentWindow;
  }
}

/**
 * Extracts email addresses from Thunderbird conversation popups.
 *
 * @param {Object} window - The window object.
 * @returns {Object} - An object containing styleLeftValues and popupValues.
 */
async function extractMailsThunderbirdConversation(window) {
  let { document } = window;
  const popupContainer = document.getElementById("popup-container");
  let popups = popupContainer.childNodes;

  let retryCount = 0;
  while (popups.length === 0 && retryCount < 20) {
    console.warn("Waiting for popups to load...");
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    popups = popupContainer.childNodes;
    retryCount++;
  }

  if (popups.length === 0) {
    console.error("No popups found in the popup container.");
    return null;
  }

  /**
   * Extracts the email address from a popup.
   * 
   * @param {HTMLElement} popup - The popup element.
   * @returns {string|null} - The email address or null if not found.
   */
  function extractMailFromPopup(popup) {
    const mail = popup.querySelector(".authorEmailAddress");
    if (mail) {
      return mail.textContent;
    }
    return null;
  }

  let styleLeftValues = {};
  let popupValues = [];

  for (let popup of popups) {
    let styleLeft = popup.style.left;
    if (styleLeftValues[styleLeft]) {
      styleLeftValues[styleLeft]++;
    } else {
      styleLeftValues[styleLeft] = 1;
    }

    let mail = extractMailFromPopup(popup);
    popupValues.push({
      left: styleLeft,
      mail: mail,
    });
  }

  return {
    styleLeftValues: styleLeftValues,
    popupValues: popupValues,
  };
}

/**
 * Gets the Thunderbird version number
 * @returns {number} - The major version number of Thunderbird
 */
function getThunderbirdVersion() {
  try {
    const appInfo = Services.appinfo;
    const version = appInfo.version;
    const majorVersion = parseInt(version.split('.')[0], 10);
    return majorVersion;
  } catch (error) {
    console.error("Error getting Thunderbird version:", error);
    // Default to a high version number to use canvas approach if detection fails
    return 145;
  }
}

/**
 * Helper function to draw a data URL directly to canvas without triggering CSP
 * @param {string} dataUrl - The data URL to draw
 * @param {HTMLCanvasElement} canvas - The canvas element to draw to
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @param {Window} win - The window object for accessing global functions
 */
async function drawDataUrlToCanvas(dataUrl, canvas, width, height, win) {
  try {
    // Extract base64 data and mime type
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      console.error("Invalid data URL format");
      return false;
    }

    const mimeType = matches[1];
    const base64Data = matches[2];

    // Decode base64 to binary - use window.atob in case atob is not global
    const atobFn = win.atob || atob;
    const binaryString = atobFn(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create blob and use createImageBitmap (no CSP check!)
    const BlobConstructor = win.Blob || Blob;
    const blob = new BlobConstructor([bytes], { type: mimeType });
    const createImageBitmapFn = win.createImageBitmap || createImageBitmap;
    const imageBitmap = await createImageBitmapFn(blob);

    // Draw to canvas
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imageBitmap, 0, 0, width, height);

    return true;
  } catch (error) {
    console.error("Error drawing data URL to canvas:", error);
    return false;
  }
}

/**
 * Installs avatars for Thunderbird conversation.
 *
 * @param {Object} window - The window object.
 * @param {Object} payload - The payload object containing URLs and data.
 */
async function installConversation(window, payload) {
  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  async function insertPictureInPopup(popup, url) {
    const avatar = popup.querySelector(".authorPicture");
    if (!avatar) return;

    // Remove old content
    while (avatar.firstChild) {
      avatar.removeChild(avatar.firstChild);
    }

    if (!url || url === "") {
      if (useCanvas) {
        // TB 145: Use canvas with default icon (CSP workaround)
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 48;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        avatar.appendChild(canvas);

        const img = document.createElement('img');
        img.onload = () => {
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, 48, 48);
        };
        img.src = "chrome://messenger/skin/addressbook/icons/contact-generic.svg";
      } else {
        // TB < 145 and TB 146+: Use img element directly
        const wrongAvatar = popup.querySelector(".autoprofilepictureimg");
        if (wrongAvatar) {
          wrongAvatar.classList.remove("autoprofilepictureimg");
          wrongAvatar.src = "chrome://messenger/skin/addressbook/icons/contact-generic.svg";
        }
      }
      return;
    }

    if (useCanvas) {
      // TB 145: Use canvas to bypass CSP restrictions
      const canvas = document.createElement("canvas");
      canvas.width = 48;
      canvas.height = 48;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      avatar.appendChild(canvas);
      await drawDataUrlToCanvas(url, canvas, 48, 48, window);
    } else {
      // TB < 145 and TB 146+: Use img element directly
      const img = document.createElement("img");
      img.src = url;
      img.className = "autoprofilepictureimg";
      img.alt = "Auto Profile Picture";
      avatar.appendChild(img);
    }
  }

  async function replaceAuthorPictureInMessage(message, url) {
    if (!url || url === "") {
      let wrongInitials = message.querySelector("abbr.auto-profile-picture");
      if (wrongInitials) {
        wrongInitials.classList.remove("auto-profile-picture");
        wrongInitials.classList.add("contactInitials");
        if (useCanvas) {
          // Remove canvas if it exists
          const canvas = wrongInitials.querySelector("canvas");
          if (canvas) {
            wrongInitials.removeChild(canvas);
          }
        } else {
          wrongInitials.style.backgroundImage = null;
        }
      }
      return;
    }

    if (useCanvas) {
      // TB 145: Use canvas approach (CSP workaround)
      let targetElement = message.querySelector(".contactInitials") || message.querySelector(".auto-profile-picture");
      if (targetElement) {
        targetElement.classList.remove("contactInitials");
        targetElement.classList.add("contactAvatar");
        targetElement.classList.add("auto-profile-picture");
        targetElement.textContent = "";

        // Remove old canvas if it exists
        const oldCanvas = targetElement.querySelector("canvas");
        if (oldCanvas) {
          targetElement.removeChild(oldCanvas);
        }

        // Create canvas to bypass CSP
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.borderRadius = "50%";

        targetElement.appendChild(canvas);

        // Use helper to bypass CSP restrictions
        await drawDataUrlToCanvas(url, canvas, 32, 32, window);
      } else {
        console.error("No contactInitials or auto-profile-picture found");
      }
    } else {
      // TB < 145 and TB 146+: Use background-image approach
      let contactInitials = message.querySelector(".contactInitials");
      if (contactInitials) {
        contactInitials.classList.remove("contactInitials");
        contactInitials.classList.add("contactAvatar");
        contactInitials.classList.add("auto-profile-picture");
        contactInitials.style.backgroundImage = `url("${url}")`;
        contactInitials.textContent = "\u00A0";
      } else {
        let autoProfilePicture = message.querySelector(".auto-profile-picture");
        if (autoProfilePicture) {
          autoProfilePicture.style.backgroundImage = `url("${url}")`;
          autoProfilePicture.textContent = "\u00A0";
        } else {
          console.error("No contactInitials or auto-profile-picture found");
        }
      }
    }
  }

  let { document } = window;

  let conversationMailCache = payload.urls;

  let styleLeftValues = payload.data.styleLeftValues;
  let popupValues = payload.data.popupValues;

  const popupContainer = document.getElementById("popup-container");
  const popups = popupContainer.querySelectorAll(".fade-popup");

  let popupNumber = 0;
  for (let popup of popups) {
    let mail = popupValues[popupNumber].mail;
    if (mail) {
      await insertPictureInPopup(popup, conversationMailCache[mail]);
    }
    popupNumber++;
  }

  let mostCommonLeftValue = Object.keys(styleLeftValues).reduce((a, b) => {
    if (styleLeftValues[a] == styleLeftValues[b]) {
      let aParsed = parseFloat(a.replace("px", ""));
      let bParsed = parseFloat(b.replace("px", ""));
      return aParsed < bParsed ? a : b;
    }
    return styleLeftValues[a] > styleLeftValues[b] ? a : b;
  });

  let popupsWithMostCommonLeftValue = popupValues.filter(
    (popup) => popup.left === mostCommonLeftValue
  );

  let messageList = document.getElementById("messageList");
  let messages = messageList.querySelectorAll(".message");

  let messageNumber = 0;
  for (let message of messages) {
    let mail = popupsWithMostCommonLeftValue[messageNumber].mail;
    if (mail) {
      await replaceAuthorPictureInMessage(message, conversationMailCache[mail]);
    }
    messageNumber++;
  }
}

/**
 * Installs an avatar or initials on the message header.
 *
 * @param {Object} window - The window object.
 * @param {Object} urls - The URLs object containing avatar URLs.
 * @returns {Object} - An object containing the status and optional data or error.
 */
async function installOnMessageHeader(window, urls) {
  let { document } = window;
  let urlOrObj = Object.values(urls)[0];

  let url = urlOrObj;
  let initialsColor = null;
  if (typeof urlOrObj === "object" && urlOrObj !== null && urlOrObj.value) {
    url = urlOrObj.value;
    initialsColor = urlOrObj.color;
  }

  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  let recipientAvatars = document.querySelectorAll(".recipient-avatar");
  let result = { status: "failed", error: "No URL found" };

  for (const recipientAvatar of recipientAvatars) {
    if (!recipientAvatar.classList.contains("has-avatar")) {
      if (!url || url === "" || url.includes("//INITIAL:")) {
        if (url && url.includes("//INITIAL:")) {
          let contactInitials = recipientAvatar.getElementsByTagName("span");
          if (contactInitials.length > 0) {
            contactInitials = contactInitials[0];
          } else {
            contactInitials = document.createElement("span");
          }
          contactInitials.classList.add("contactInitials");
          contactInitials.classList.add("auto-profile-picture");
          if (contactInitials.textContent !== url.replace("//INITIAL:", "")) {
            contactInitials.textContent = url.replace("//INITIAL:", "");
          }
          if (initialsColor) {
            recipientAvatar.style.background = initialsColor;
          }
          recipientAvatar.appendChild(contactInitials);
        }
        result = { status: "failed", error: "No URL found" };
        continue;
      }

      // Remove old content
      while (recipientAvatar.firstChild) {
        recipientAvatar.removeChild(recipientAvatar.firstChild);
      }

      if (useCanvas) {
        // TB 145: Use canvas to bypass CSP restrictions
        const canvas = document.createElement("canvas");
        const size = 34; // Default avatar size
        canvas.width = size;
        canvas.height = size;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.borderRadius = "50%";

        recipientAvatar.appendChild(canvas);

        // Use helper to bypass CSP restrictions
        await drawDataUrlToCanvas(url, canvas, size, size, window);
      } else {
        // TB < 145 and TB 146+: Use img element directly
        let img = document.createElement("img");
        img.src = url;
        img.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        img.setAttribute("data-l10n-id", "message-header-recipient-avatar");
        recipientAvatar.appendChild(img);
        recipientAvatar.style.background = null;
      }

      recipientAvatar.classList.add("has-avatar");
      result = { status: "success" };
    } else {
      result = { status: "success" };
    }
  }
  if (recipientAvatars.length > 0) {
    return result;
  }

  let popupContainer = document.getElementById("popup-container");
  if (popupContainer) {
    const dataMails = await extractMailsThunderbirdConversation(window, urls);
    return {
      status: "needData",
      data: dataMails,
    };
  }

  return {
    status: "failed",
  };
}

/**
 * Installs CSS styles for avatars.
 *
 * @param {Object} window - The window object.
 */
function installCss(window) {
  let { document } = window;
  const avatarCss = `
  :root {
    --recipient-avatar-size: 34px;
  }
  .recipient-avatar {
    height: var(--recipient-avatar-size);
    width: var(--recipient-avatar-size);
    border-radius: 50%;
    text-align: center;
    overflow: hidden;
    align-items: center;
    justify-content: center;
    display:inline-flex;
    vertical-align: middle;
    margin-inline-end: 1px;
    color: light-dark(#71717a, #a1a1aa);
    margin-top: 1px;
  }
  .recipient-avatar.no-avatar {
    background-color: light-dark(#d4d4d8, #52525b);
  }
  .recipient-avatar {
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
  .card-layout {
    --placeholder-margin: 4px;
  }
  /* Compact layout */
  .card-layout[style="height: 60px;"] {
    --placeholder-margin: 1px;
  }
  .card-container > .thread-card-column:first-child:not(:has(.recipient-avatar)) {
    margin-right: calc(var(--recipient-avatar-size) + var(--placeholder-margin));
  }
  .table-layout {
    --recipient-avatar-size: 15px;
    --top-position: calc(50% - 7.5px);
  }
  .table-layout[style="height: 30px;"] {
    --recipient-avatar-size: 20px;
    --top-position: calc(50% - 10px);
  }
  .correspondentcol-column .recipient-avatar {
    position: absolute;
    left: 4.5px;
    top: var(--top-position);
  }
  `;
  if (document.getElementById("auto-profile-picture-style")) {
    return;
  }
  let style = document.createElement("style");

  style.textContent = avatarCss;
  style.id = "auto-profile-picture-style";
  document.head.appendChild(style);
}

/**
 * Uninstalls CSS styles for avatars.
 * 
 * @param {Object} window - The window object.
 */
function uninstallCss(window) {
  let { document } = window;
  let style = document.getElementById("auto-profile-picture-style");
  if (style) {
    style.remove();
  }
}

/**
 * Installs an avatar or initials on a given row element of the inbox list.
 *
 * @param {Document} document - The document object.
 * @param {string|Object} urlOrObj - The URL of the avatar image or an object with value and color for initials.
 * @param {HTMLElement} row - The row element where the avatar or initials will be installed.
 * @param {boolean} temporary - A flag indicating whether the avatar is temporary.
 * @returns {Promise<boolean>} - Returns true if the avatar or initials were successfully installed, otherwise false.
 */
async function installOnRow(document, urlOrObj, row, temporary) {
  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  let recipientAvatar = row.querySelector(".recipient-avatar");
  const hasNoAvatar = !recipientAvatar;
  if (hasNoAvatar) {
    recipientAvatar = document.createElement("div");
    recipientAvatar.classList.add("recipient-avatar");
  }

  let url = urlOrObj;
  let initialsColor = null;
  if (typeof urlOrObj === "object" && urlOrObj !== null && urlOrObj.value) {
    url = urlOrObj.value;
    initialsColor = urlOrObj.color;
  }

  if (useCanvas) {
    // TB 145: Use canvas approach (CSP workaround)
    // Check if image is already installed using background-image style
    const currentBackgroundImage = recipientAvatar.style.backgroundImage;
    const expectedBackgroundImage = typeof urlOrObj === "string" ? `url("${urlOrObj}")` : null;

    if (currentBackgroundImage && expectedBackgroundImage && currentBackgroundImage === expectedBackgroundImage) {
      // Image already installed and correct
      return false;
    }

    let contactInitials = recipientAvatar.querySelector(".contactInitials");

    if (url && url !== "" && !url.includes("//INITIAL:")) {
      // Valid image URL - use canvas to bypass CSP restrictions
      recipientAvatar.classList.add("has-avatar");
      recipientAvatar.classList.remove("no-avatar");

      // Remove old content
      while (recipientAvatar.firstChild) {
        recipientAvatar.removeChild(recipientAvatar.firstChild);
      }

      // Create canvas element
      const canvas = document.createElement("canvas");
      const win = document.defaultView || window;
      const size = parseInt(win.getComputedStyle(recipientAvatar).width) || 34;
      canvas.width = size;
      canvas.height = size;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.borderRadius = "50%";

      recipientAvatar.appendChild(canvas);

      // Use helper to bypass CSP restrictions
      await drawDataUrlToCanvas(url, canvas, size, size, win);
    } else if (url && url.includes("//INITIAL:") && (!currentBackgroundImage || !temporary)) {
      // Valid initials without image or not temporary (ie. no image has been found)
      recipientAvatar.classList.add("no-avatar");
      recipientAvatar.classList.remove("has-avatar");
      recipientAvatar.style.backgroundImage = "";
      if (!contactInitials) {
        contactInitials = document.createElement("span");
        contactInitials.classList.add("contactInitials");
        contactInitials.classList.add("auto-profile-picture");
        recipientAvatar.appendChild(contactInitials);
      }
      // Remove any img elements that might exist
      const oldImg = recipientAvatar.querySelector("img");
      if (oldImg) {
        recipientAvatar.removeChild(oldImg);
      }
      if (initialsColor) {
        recipientAvatar.style.background = initialsColor;
      }
      if (contactInitials.textContent === url.replace("//INITIAL:", "")) {
        return false;
      }
      contactInitials.textContent = url.replace("//INITIAL:", "");
    } else {
      return false;
    }
  } else {
    // TB < 145 and TB 146+: Use img element approach
    let img = recipientAvatar.querySelector("img");
    const hasNoImg = !img;
    if (hasNoImg) {
      img = document.createElement("img");
      img.alt = "Auto Profile Picture";
      img.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      recipientAvatar.appendChild(img);
    } else if (typeof urlOrObj === "string" && img.src === urlOrObj) {
      // Image already installed and correct
      return false;
    }

    let contactInitials = recipientAvatar.querySelector(".contactInitials");

    if (url && url !== "" && !url.includes("//INITIAL:")) {
      // Valid image URL
      recipientAvatar.classList.add("has-avatar");
      recipientAvatar.classList.remove("no-avatar");
      img.src = url;
      if (contactInitials) {
        // Remove initials if they exist
        recipientAvatar.removeChild(contactInitials);
        recipientAvatar.style.background = null;
      }
    } else if (url && url.includes("//INITIAL:") && (hasNoImg || !temporary)) {
      // Valid initials without image or not temporary (ie. no image has been found)
      recipientAvatar.classList.add("no-avatar");
      recipientAvatar.classList.remove("has-avatar");
      if (!contactInitials) {
        contactInitials = document.createElement("span");
        contactInitials.classList.add("contactInitials");
        contactInitials.classList.add("auto-profile-picture");
        recipientAvatar.appendChild(contactInitials);
      }
      recipientAvatar.removeChild(img);
      if (initialsColor) {
        recipientAvatar.style.background = initialsColor;
      }
      if (contactInitials.textContent === url.replace("//INITIAL:", "")) {
        return false;
      }
      contactInitials.textContent = url.replace("//INITIAL:", "");
    } else {
      return false;
    }
  }

  if (hasNoAvatar) {
    let threadCardColumn = row.querySelector(".thread-card-column");
    if (threadCardColumn) {
      threadCardColumn.style.display = "flex";
      threadCardColumn.style.flexDirection = "row";
      threadCardColumn.appendChild(recipientAvatar);
    } else {
      let correspondantColumn = row.querySelector(".correspondentcol-column");
      if (correspondantColumn) {
        correspondantColumn.insertBefore(recipientAvatar, correspondantColumn.firstChild);
      }
    }
  }

  return true;
}

/**
 * Gets the ID of the first row in the thread tree.
 *
 * @param {Map} rows - The rows map.
 * @returns {number} - The ID of the first row.
 */
async function getRowFirstId(rows) {
  try {
    let rowKeys = rows.keys();
    let minimumRowKey = Math.min(...rowKeys);
    let row = rows.get(minimumRowKey);
    return parseInt(row.id.replace("threadTree-row", ""));
  } catch (error) { }

  try {
    let row = rows[0][1];
    return parseInt(row.id.replace("threadTree-row", ""));
  } catch (error) {
    return 0;
  }
}

/**
 * Gets the total number of messages in the view.
 *
 * @param {Object} window - The window object.
 * @returns {number} - The total number of messages.
 */
async function getTotalMessagesView(window) {
  let { document } = window;
  try {
    return await window.gFolder.getTotalMessages(false);
  } catch (e) { }
  try {
    let counter = document.getElementById("threadPaneFolderCount");
    let data = JSON.parse(counter.dataset.l10nArgs);
    return data.count;
  } catch (e) {
    return 0;
  }
}

/**
 * Removes the avatar from a row element.
 *
 * @param {HTMLElement} row - The row element.
 */
function removeAvatarFromRow(row) {
  let recipientAvatar = row.querySelector(".recipient-avatar");
  if (recipientAvatar) {
    recipientAvatar.remove();
  }
}

/**
 * Gets the number of expanded dummy rows in the thread tree.
 * Taken from isGroupedByHeaderAtIndex in mail/modules/DBViewWrapper.sys.mjs:2124
 *
 * @param {Object} threadTree - The thread tree object.
 * @param {number} maxIndex - The maximum index to check.
 * @returns {number} - The number of expanded dummy rows.
 */
function getExpandedDummyRowsNumber(threadTree, maxIndex) {
  const MSG_VIEW_FLAG_DUMMY = 0x20000000;
  let dummyRows = 0, previousRowDummy = false;
  for (let i = 0; i < maxIndex; i++) {
    if (Boolean(threadTree._view.getFlagsAt(i) & MSG_VIEW_FLAG_DUMMY)) {
      previousRowDummy = true;
    } else {
      if (previousRowDummy) {
        dummyRows++;
      }
      previousRowDummy = false;
    }
  }
  return dummyRows;
}

/**
 * Installs avatars or initials on the inbox list.
 *
 * @param {Object} window - The window object.
 * @param {Array} urls - The array of avatar URLs or initials.
 * @param {Map} rows - The rows map.
 * @param {number} offset - The offset for the rows.
 * @param {boolean} temporary - A flag indicating whether the avatars are temporary.
 * @returns {Promise<Object>} - An object containing the status.
 */
async function installInboxList(window, urls, rows, offset, temporary) {
  let { document } = window;
  let nbInstalled = 0;

  let threadTree = document.getElementById("threadTree");

  // filter out rows that have data-properties="dummy" and aria-expanded="true" for grouped by sort view
  let removedRows = [];
  rows = new Map([...rows].sort((a, b) => a[0] - b[0]));
  const minRowKey = Math.min(...rows.keys());
  rows = new Map([...rows].filter(([key, value]) => {
    if (value.getAttribute("data-properties") === "dummy" && value.getAttribute("aria-expanded") === "true") {
      removedRows.push([key, value]);
      return false;
    }
    if (value.getAttribute("data-properties") && value.getAttribute("data-properties").includes("imapdeleted")) { // filter out deleted rows
      removedRows.push([key, value]);
      return false;
    }
    return true;
  }));

  const removedRowsKeys = removedRows.map(([key, value]) => key);

  // reindex map keys and includes removed rows
  const hiddenDummyRows = getExpandedDummyRowsNumber(threadTree, minRowKey);

  const indexShift = minRowKey - hiddenDummyRows;

  rows = new Map([...rows].map(([key, value], index) => {
    if (removedRowsKeys.includes(key - 1)) {
      let [, removedRow] = removedRows.find(([index, value]) => index === key - 1);
      return [index + indexShift, [removedRow, value]];
    }
    return [index + indexShift, value];
  }));

  for (let i = 0; i < urls.length; i++) {
    const currentRow = i + offset;
    const url = urls[i];

    let row = rows.get(currentRow);

    if (Array.isArray(row)) {
      let [removedRow, newRow] = row;
      removeAvatarFromRow(removedRow);
      row = newRow;
    }

    if (!row) {
      continue;
    }

    if (row.getAttribute("data-properties") === "dummy") {
      removeAvatarFromRow(row);
      continue;
    }

    let res = await installOnRow(document, url, row, temporary);

    if (res) {
      nbInstalled++;
    }
  }
  // console.log("installed", nbInstalled, temporary ? "initials" : "avatars");
  return {
    status: "success",
  };
}

/**
 * Uninstalls the avatars or initials.
 *
 * @param {Object} window - The window object.
 */
function uninstall(window) {
  uninstallCss(window);
}

let timeoutInitials = null;
let timeoutInboxList = null;

const EVENTS_TO_LISTEN = [
  "viewchange",
  "rowcountchange",
  "collapsed",
  "expanded",
  "showplaceholder",
  "scroll",
  "change",
  "drop",
  "click"
];
const EVENTS_TABLE_TO_LISTEN = [
  "thread-changed",
  "sort-changed"
]
const INITIALS_TIMEOUT = 500;
const INBOX_LIST_TIMEOUT = 1000;

/**
 * Handles the installation of initials on the inbox list.
 *
 * @param {Object} window - The window object.
 * @param {Array} payload - The array of initials.
 * @param {Map} rows - The rows map.
 * @param {number} offset - The offset for the rows.
 * @returns {Promise<Object>} - An object containing the status.
 */
async function handleInitials(window, payload, rows, offset) {
  window.clearTimeout(window.timeoutInitials);
  window.timeoutInitials = window.setTimeout(async () => {
    // console.log("initials setTimeout installInboxList call");
    await installInboxList(window, payload, rows, offset, true);
  }, INITIALS_TIMEOUT);

  await installInboxList(window, payload, rows, offset, true);
  return { status: "success" };
}

/**
 * Handles the installation of avatars on the inbox list.
 *
 * @param {Object} window - The window object.
 * @param {Array} payload - The array of avatar URLs.
 * @param {Object} threadTree - The thread tree object.
 * @param {number} offset - The offset for the rows.
 * @returns {Object} - An object containing the status and optional event type.
 */
async function handleInboxList(window, payload, threadTree, offset) {
  window.clearTimeout(window.timeoutInboxList);

  try {
    window.timeoutInboxList = window.setTimeout(async () => {
      await installInboxList(window, payload, threadTree._rows, offset, false);
    }, INBOX_LIST_TIMEOUT);
    await installInboxList(window, payload, threadTree._rows, offset, false);

    if (offset < 15) {
      const eventType = await initializeAllEventListeners(threadTree, payload.length, window);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      return { status: "needReprint", eventType: eventType };
    } else {
      return { status: "success" };
    }
  } catch (e) {
    console.error(e);
    return { status: "failed", error: e };
  }
}

/**
 * Initializes event listeners on the thread tree.
 * 
 * @param {Object} threadTree - The thread tree object.
 * @param {number} payloadLength - The length of the payload.
 * @param {Object} window - The window object.
 * @return {Promise} - A promise that resolves with the event type.
 */
async function initializeAllEventListeners(threadTree, payloadLength, window) {
  const eventsToListen = new Set(EVENTS_TO_LISTEN);
  if (threadTree._rows.length === payloadLength) {
    eventsToListen.delete("scroll");
  }
  let tableThreadTree = threadTree.getElementsByTagName("table")[0];
  const eventType = await Promise.race([
    setupEventListeners(tableThreadTree, EVENTS_TABLE_TO_LISTEN, window),
    setupEventListeners(threadTree, eventsToListen, window),
  ]);
  return eventType;
}

/**
 * Checks if all avatars are installed on the thread tree.
 * 
 * @param {Object} table - The table or threadTree element.
 * @returns {boolean} - Returns true if all avatars are installed, otherwise false.
 */
function areAvatarsInstalled(table) {
  let rows = table.querySelectorAll('tr[is="thread-row"], tr[is="thread-card"]');
  for (let row of rows) {
    let recipientAvatar = row.querySelector(".recipient-avatar");
    if (!recipientAvatar) {
      return false;
    }
  }
  return true;
}

/**
 * Sets up event listeners on the thread tree.
 *
 * @param {Object} threadTree - The thread tree object.
 * @param {Set} eventsToListen - The set of events to listen for.
 * @param {Object} window - The window object.
 * @returns {Promise} - A promise that resolves with the event type.
 */
function setupEventListeners(threadTree, eventsToListen, window) {
  return new Promise((resolve) => {
    const handleEvent = (event) => {
      // console.log("TT resolve", event.type);
      cleanup();
      resolve(event.type);
    };

    const cleanup = () => {
      for (const event of eventsToListen) {
        threadTree.removeEventListener(event, handleEvent);
      }
      observer.disconnect();
    };

    const observer = new window.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target.classList.contains("recipient-avatar") ||
          mutation.target.classList.contains("contactInitials") ||
          (mutation.target.alt && mutation.target.alt.includes("Auto Profile Picture"))) {
          // mutations caused by the extension
          continue;
        }
        if (mutation.type === "childList" && mutation.removedNodes.length > 0) {
          cleanup();
          window.setTimeout(() => {
            if (!areAvatarsInstalled(threadTree)) {
              resolve("childList");
            }
          }, 300); // WAIT_TIME_MS - 200
        }
      }
    });
    observer.observe(threadTree, { childList: true, subtree: true, attributes: true });

    for (const event of eventsToListen) {
      threadTree.removeEventListener(event, handleEvent);
      threadTree.addEventListener(event, handleEvent, { once: true });
    }
  });
}

var headerApi = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      headerApi: {
        /**
         * Installs avatars on message headers.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} urlJSON - The JSON string containing avatar URLs.
         * @returns {Object} - An object containing the status and optional data or error.
         */
        async pictureHeaders(tabId, urlJSON) {
          let urls = JSON.parse(urlJSON);
          let { nativeTab } = context.extension.tabManager.get(tabId);
          let messageBrowserWindow = getMessageWindow(nativeTab);
          if (messageBrowserWindow) {
            try {
              return await installOnMessageHeader(messageBrowserWindow, urls);
            } catch (e) {
              console.error(e);
              return {
                status: "failed",
                error: e,
              };
            }
          }
          return {
            status: "failed",
            error: "No messageBrowser window found",
          };
        },
        /**
         * Installs avatars in Thunderbird conversation.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} payloadJSON - The JSON string containing payload data.
         * @returns {Object} - An object containing the status and optional data or error.
         */
        async pictureHeadersConversation(tabId, payloadJSON) {
          let payload = JSON.parse(payloadJSON);
          let { nativeTab } = context.extension.tabManager.get(tabId);
          let messageBrowserWindow = getMessageWindow(nativeTab);
          if (messageBrowserWindow) {
            try {
              return await installConversation(messageBrowserWindow, payload);
            } catch (e) {
              console.error(e);
              return {
                status: "failed",
                error: e,
              };
            }
          }
          return {
            status: "failed",
            error: "No messageBrowser window found",
          };
        },
        /**
         * Installs avatars or initials on the inbox list.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} urlJSON - The JSON string containing avatar URLs or initials.
         * @param {number} offset - The offset for the rows.
         * @param {boolean} initials - A flag indicating whether initials are being installed.
         * @returns {Object} - An object containing the status and optional event type.
         */
        async pictureInboxList(
          tabId,
          urlJSON = "{}",
          offset = 0,
          initials = false
        ) {
          const payload = JSON.parse(urlJSON);
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = getContentWindow(nativeTab);
          const threadTree = window.threadTree;

          installCss(window);

          if (initials) {
            return handleInitials(window, payload, threadTree._rows, offset);
          }

          return handleInboxList(window, payload, threadTree, offset);
        },
        /**
         * Gets the ID of the first displayed message in the thread tree.
         *
         * @param {number} tabId - The tab ID.
         * @returns {number} - The ID of the first displayed message.
         */
        async getFirstDisplayedMessageId(tabId) {
          let { nativeTab } = context.extension.tabManager.get(tabId);
          let window = nativeTab.chromeBrowser.contentWindow;
          let threadTree = window.threadTree;
          return await getRowFirstId(threadTree._rows);
        },
        /**
         * Gets the total number of messages in the view.
         *
         * @param {number} tabId - The tab ID.
         * @returns {number} - The total number of messages.
         */
        async getTotalMessagesCount(tabId) {
          let { nativeTab } = context.extension.tabManager.get(tabId);
          let window = nativeTab.chromeBrowser.contentWindow;
          const msgNb = await getTotalMessagesView(window);
          return msgNb;
        },

        /**
         * Installs event listeners on the inbox list.
         * 
         * @param {number} tabId - The tab ID.
         */
        async installEventListeners(tabId) {
          let { nativeTab } = context.extension.tabManager.get(tabId);
          let window = getContentWindow(nativeTab);
          let threadTree = window.threadTree;
          const eventType = await initializeAllEventListeners(threadTree, 0, window);
          return eventType;
        }
      },
    };
  }

  onShutdown(isAppShutdown) {
    for (let window of Services.wm.getEnumerator("mail:3pane")) {
      for (let nativeTab of window.gTabmail.tabInfo) {
        let messageBrowserWindow = getMessageWindow(nativeTab);
        if (messageBrowserWindow) {
          uninstall(messageBrowserWindow);
        }
      }
    }

    for (let window of Services.wm.getEnumerator("mail:messageWindow")) {
      let messageBrowserWindow = getMessageWindow(window);
      if (messageBrowserWindow) {
        uninstall(messageBrowserWindow);
      }
    }
  }
};
