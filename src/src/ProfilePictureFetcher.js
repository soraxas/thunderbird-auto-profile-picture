import ProviderFactory from "../providers/ProviderFactory.js";
import defaultSettings from "../settings/defaultSettings.js";
import Author from "./Author.js";
import CacheStorage from "./CacheStorage.js";
import debug from "./Debug.js";
import { AvatarStrategy } from "./strategies/AvatarStrategy.js";
import { CacheStrategy } from "./strategies/CacheStrategy.js";
import { ContactsStrategy } from "./strategies/ContactsStrategy.js";
import { OnlineStrategy } from "./strategies/OnlineStrategy.js";
import { VoidStrategy } from "./strategies/VoidStrategy.js";

export default class ProfilePictureFetcher {
  /**
   *
   * @param {Window} wdow Window object
   * @param {Author} authorObject Author object to fetch the avatar for
   * @param {string} providerName Provider name to use for fetching the avatar
   * @param {boolean} disableCache Disable cache
   */
  constructor(
    wdow,
    authorObject,
    providerName = "duckduckgo",
    disableCache = false,
  ) {
    this.wdow = wdow;
    this.author = authorObject;
    this.provider = ProviderFactory.createProvider(providerName, wdow);
    this.gravatarProvider = ProviderFactory.createProvider("gravatar", wdow);
    this.libravatarProvider = ProviderFactory.createProvider(
      "libravatar",
      wdow,
    );
    this.bimiProvider = ProviderFactory.createProvider("bimi", wdow);
    this.webProvider = ProviderFactory.createProvider("favicon_webpage", wdow);
    this.providerName = providerName;
    this.domain = authorObject.getDomain();
    this.cache = new CacheStorage();
    this.disableCache = disableCache;
  }

  /**
   * Converts a blob to a URL
   * @param {Blob} blob blob to convert to URL
   * @returns {Promise<string>} URL of the blob (data URL)
   */
  async blobToUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Converts a blob to a file
   * @param {Blob} blob blob to convert to file
   * @returns {File} File object
   */
  blobToFile(blob) {
    const file = new File([blob], "avatar", { type: blob.type });
    return file;
  }

  /**
   * Saves a blob to the cache
   * @param {Blob} blob Blob to save
   * @param {string} iconDomain Domain associated with the icon
   * @param {string} source Source of the icon
   */
  async saveBlobToCache(blob, iconDomain, source) {
    const iconPath = `ICON_${iconDomain}.ico`;

    await this.cache.saveIcon(iconPath, blob);

    const fileInfos = {
      path: iconPath,
      type: blob.type,
      ts: Date.now(),
      source: source,
    };

    this.cache.setProperty(`ICON_${iconDomain}`, fileInfos);
    if (source === "gravatar" || this.author.isPublic()) {
      this.cache.setProperty(`ICON_${this.author.getEmail()}`, fileInfos);
    } else {
      this.cache.setProperty(`ICON_${this.domain}`, fileInfos);
    }
  }

  /**
   * Saves a "not found" status to the cache
   * @param {string} iconDomain Domain associated with the icon
   */
  async saveNotFoundToCache(iconDomain) {
    const notFoundObject = {
      type: "notFound",
      ts: Date.now(),
    };

    this.cache.setProperty(`ICON_${iconDomain}`, notFoundObject);
    if (this.author.isPublic()) {
      this.cache.setProperty(`ICON_${this.author.getEmail()}`, notFoundObject);
    } else {
      this.cache.setProperty(`ICON_${this.domain}`, notFoundObject);
    }
  }

  /**
   * Downloads an image from a URL
   * @param {string} url URL to download the image from
   * @param {string} iconDomain Domain associated with the icon
   * @param {string} source Source of the icon
   * @returns {Blob|null} Blob of the downloaded image or null if not found
   */
  async downloadImage(url, iconDomain, source = this.providerName) {
    return await this.wdow.fetch(url).then(async (response) => {
      if ((response.status === 404 && source === "gravatar") || !response.ok) {
        return null;
      }
      let blob = await response.blob();

      if (blob.type.includes("text/plain")) {
        const string = await blob.text();
        if (string.includes("svg")) {
          // wrong header returned by the server : text/plain instead of image/svg+xml
          // happens with noreply@recruiting.facebook.com for instance
          blob = new Blob([string], { type: "image/svg+xml" });
        } else {
          throw new Error("Invalid image type", blob.type);
        }
      }

      if (!blob.type.startsWith("image/")) {
        // Some servers return 200 with a non-image body (redirect/error/
        // parked-domain page, JSON, etc) instead of a real 404. Caching
        // that as an "avatar" produces a data: URL the <img> element can
        // never render, and since it's written to the persistent cache it
        // would keep returning the same broken result on every future
        // lookup instead of ever letting a later provider succeed. Treat
        // it like "not found" so the strategy chain falls through.
        debug.log(
          `${source} for ${iconDomain} returned non-image content-type "${blob.type}", skipping`,
        );
        return null;
      }

      this.saveBlobToCache(blob, iconDomain, source);

      return blob;
    });
  }

  /**
   * Retrieves an icon from the cache
   * @param {string} domain Domain associated with the icon
   * @param {string|null} originalDomain Original domain associated with the icon
   * @returns {Blob|string|boolean} Blob of the icon, "notFound" if not found, or false if not in cache
   */
  async getFromCache(domain, originalDomain = null) {
    if (this.disableCache) {
      return false;
    }
    if (this.author.isPublic() && domain !== this.author.getEmail()) {
      originalDomain = this.author.getEmail();
    }
    const key = `ICON_${domain}`;

    const fileInfos = await this.cache.getProperty(key);
    if (!fileInfos) {
      return false;
    }

    try {
      if (fileInfos.type === "notFound") {
        return "notFound";
      }
      if (!fileInfos.type.startsWith("image/")) {
        // Entry predates the downloadImage content-type validation (or is
        // otherwise corrupted) - it's not a real image and would just fail
        // to render again. Self-heal by dropping it instead of returning
        // it, so the strategy chain gets a fresh shot at a real avatar.
        debug.log(
          `Dropping stale non-image cache entry for ${domain} (was "${fileInfos.type}")`,
        );
        this.cache.removeProperty(key);
        return false;
      }
      const blob = await this.cache.getIcon(fileInfos.path, fileInfos.type);
      if (originalDomain) {
        this.cache.setProperty(`ICON_${originalDomain}`, fileInfos);
      }
      return blob;
    } catch (_error) {
      // corrupted entry
      this.cache.removeProperty(key);
      return false;
    }
  }

  /**
   * Awaits a strategy's fetchAvatar() promise, but gives up after `ms` and
   * resolves to null instead, so one slow provider can't stall the whole
   * strategy chain. The abandoned promise keeps running in the background
   * (its result still gets cached for next time via saveBlobToCache), it's
   * just not waited on for this lookup.
   * @param {Promise} promise The strategy's fetchAvatar() promise.
   * @param {number} ms Timeout in milliseconds.
   * @param {string} label Strategy label, for the timeout debug log.
   * @param {string} target Domain/email being looked up, for the timeout debug log.
   * @returns {Promise<Blob|string|null>}
   */
  withTimeout(promise, ms, label, target) {
    const guardedPromise = promise.catch((error) => {
      console.error(`Error in strategy ${label} for ${target}:`, error);
      return null;
    });
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        debug.log(`${label} for ${target} exceeded ${ms}ms, moving on`);
        resolve(null);
      }, ms);
    });
    return Promise.race([guardedPromise, timeout]).finally(() => {
      clearTimeout(timeoutId);
    });
  }

  /**
   * Executes a series of strategies to fetch an avatar
   * @param {Array<AvatarStrategy>} strategies Array of strategies to execute
   * @returns {Blob|string} Blob of the avatar or "notFound" if not found
   */
  async executeStrategies(strategies) {
    const traceId = debug.nextId();
    const target = this.domain || this.author.getEmail();
    for (const strategy of strategies) {
      const label = strategy.strategyName || strategy.constructor.name;
      const startMark = `strategy-${traceId}-${label}-start`;
      const endMark = `strategy-${traceId}-${label}-end`;
      debug.mark(startMark);
      const avatar = await this.withTimeout(
        strategy.fetchAvatar(),
        defaultSettings.STRATEGY_TIMEOUT_MS,
        label,
        target,
      );
      debug.mark(endMark);
      debug.measure(`${label} for ${target}`, startMark, endMark);
      if (avatar) {
        debug.log(`Avatar resolved via ${label} for ${target}`);
        return avatar;
      }
    }
    debug.log(`No avatar found for ${target} after ${strategies.length} strategies`);
    return "notFound";
  }

  /**
   * Fetches the domain avatar using various strategies
   * @returns {Blob|string} Blob of the avatar or "notFound" if not found
   */
  async getDomainAvatar() {
    const topDomain = this.author.getTopDomain();
    const strategies = [
      new ContactsStrategy(this, this.author),
      new CacheStrategy(this, this.author.getEmail()),
      new CacheStrategy(this, this.domain),
      new OnlineStrategy(this, this.bimiProvider, this.author), // company first
      this.author.hasSubDomain()
        ? new CacheStrategy(this, topDomain)
        : new VoidStrategy(),
      this.author.hasSubDomain()
        ? new OnlineStrategy(
            this,
            this.bimiProvider,
            this.author.removeSubDomain(),
          )
        : new VoidStrategy(),
      new OnlineStrategy(this, this.gravatarProvider, this.author),
      new OnlineStrategy(this, this.libravatarProvider, this.author),
      new OnlineStrategy(this, this.provider, this.author),
      new OnlineStrategy(this, this.webProvider, this.author),
      this.author.hasSubDomain()
        ? new OnlineStrategy(this, this.provider, this.author.removeSubDomain())
        : new VoidStrategy(),
      this.author.hasSubDomain()
        ? new OnlineStrategy(
            this,
            this.webProvider,
            this.author.removeSubDomain(),
          )
        : new VoidStrategy(),
    ];
    return await this.executeStrategies(strategies);
  }

  /**
   * Fetches the public avatar using various strategies
   * @returns {Blob|string} Blob of the avatar or "notFound" if not found
   */
  async getPublicAvatar() {
    const strategies = [
      new ContactsStrategy(this, this.author),
      new CacheStrategy(this, this.author.getEmail()),
      new OnlineStrategy(this, this.gravatarProvider, this.author),
      new OnlineStrategy(this, this.libravatarProvider, this.author),
    ];
    return await this.executeStrategies(strategies);
  }

  /**
   * Fetches the avatar blob
   * @returns {Blob|null} Blob of the avatar or null if not found
   */
  async getAvatarBlob() {
    try {
      const response = this.author.isPublic()
        ? await this.getPublicAvatar()
        : await this.getDomainAvatar();
      if (response === "notFound") {
        this.saveNotFoundToCache(this.domain);
        return null;
      }
      return response;
    } catch (error) {
      console.error("Error fetching avatar", error);
      return null;
    }
  }

  /**
   * Fetches the avatar in the specified format
   * @param {string} format Format of the avatar ("url" or "file")
   * @returns {Promise<string|File|null>} URL or File object of the avatar or null if not found
   */
  async getAvatar(format = "url") {
    const blob = await this.getAvatarBlob();
    if (blob) {
      return format === "file"
        ? this.blobToFile(blob)
        : await this.blobToUrl(blob);
    }
    return null;
  }
}
