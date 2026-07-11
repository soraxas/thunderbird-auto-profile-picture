import defaultSettings from "../settings/defaultSettings.js";
import Author from "./Author.js";
import ProfilePictureFetcher from "./ProfilePictureFetcher.js";

/**
 * Service for managing avatar URLs.
 */
export default class AvatarService {
  constructor() {
    /**
     * Cache for storing avatar URLs (or in-flight fetch promises) for the session.
     * @type {Object.<string, string|null|Promise<string|null>>}
     */
    this.sessionCacheAvatarUrls = {};
  }

  /**
   * Returns the number of avatars that are currently being fetched.
   * @returns {number} - The number of avatars being fetched.
   */
  countWaitingAvatars() {
    let waiting = 0;
    for (const key in this.sessionCacheAvatarUrls) {
      if (this.sessionCacheAvatarUrls[key] instanceof Promise) {
        waiting++;
      }
    }
    return waiting;
  }

  /**
   * Retrieves the avatar URL for the given author.
   *
   * Steps:
   * 1. Check if the avatar URL is already in the session cache (including a
   *    "not found" result, so it isn't re-fetched every time)
   * 2. If not in cache:
   *    a. Check if we're already processing too many requests
   *    b. Store the in-flight fetch promise in the cache so concurrent
   *       lookups for the same author await it directly instead of polling
   * 3. Await and return the cached value (a resolved URL/null, or the
   *    in-flight promise from another concurrent call for the same author)
   *
   * @param {Author} author - The author for whom to fetch the avatar URL.
   * @returns {Promise<string|null>} - The avatar URL or null if request limit exceeded or not found.
   */
  async getAvatar(author) {
    const lcAuthor = author.getAuthor().toLowerCase();
    if (!(lcAuthor in this.sessionCacheAvatarUrls)) {
      if (this.countWaitingAvatars() > defaultSettings.MAX_REQUEST_SIZE) {
        console.warn(
          "Too many requests in progress, skipping avatar fetch for " +
            author.getAuthor(),
        );
        return null;
      }
      const profilePictureFetcher = new ProfilePictureFetcher(window, author);
      this.sessionCacheAvatarUrls[lcAuthor] = profilePictureFetcher
        .getAvatar()
        .then((url) => {
          this.sessionCacheAvatarUrls[lcAuthor] = url;
          return url;
        })
        .catch((error) => {
          delete this.sessionCacheAvatarUrls[lcAuthor];
          throw error;
        });
    }
    return await this.sessionCacheAvatarUrls[lcAuthor];
  }
}
