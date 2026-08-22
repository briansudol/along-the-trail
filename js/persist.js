/**
 * Persistence for community uploads and newsletter signups.
 *
 * Backends, in order:
 *   1. Local admin_server.py  (python3 admin_server.py — writes to disk)
 *   2. Supabase               (when backend-config.js has url + anon key)
 *   3. Formspree              (newsletter only)
 *   4. localStorage           (demo fallback)
 *
 * Approved photos also live in data/community.json so they can be committed
 * to GitHub and served on GitHub Pages.
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "mushroom-atlas-community-v1";
  var MINE_KEY = "mushroom-atlas-community-mine-v1";
  var NEWSLETTER_KEY = "mushroom-atlas-newsletter-v1";
  var MAX_DIM = 1600;
  var JPEG_QUALITY = 0.82;

  var mode = "localStorage";
  var ready = null;
  var supabaseClient = null;

  function cfg() {
    return global.TRAIL_BACKEND || {};
  }

  function hasSupabase() {
    var c = cfg();
    return !!(c.supabaseUrl && c.supabaseAnonKey);
  }

  function hasFormspree() {
    return !!cfg().formspreeNewsletter;
  }

  function moderateSecret() {
    return (cfg().moderateSecret || "").trim();
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error("timeout"));
      }, ms);
      promise.then(
        function (v) {
          clearTimeout(t);
          resolve(v);
        },
        function (e) {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  function probeLocalApi() {
    return withTimeout(
      fetch("/api/health", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("no api");
        return r.json();
      }),
      2000
    )
      .then(function (j) {
        return !!(j && j.ok && j.persist);
      })
      .catch(function () {
        return false;
      });
  }

  function loadSupabaseLib() {
    if (global.supabase && global.supabase.createClient) {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src =
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
      s.async = true;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error("Could not load Supabase"));
      };
      document.head.appendChild(s);
    });
  }

  function getSupabase() {
    if (supabaseClient) return Promise.resolve(supabaseClient);
    return loadSupabaseLib().then(function () {
      var c = cfg();
      supabaseClient = global.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
      return supabaseClient;
    });
  }

  function init() {
    if (ready) return ready;
    ready = probeLocalApi().then(function (localOk) {
      if (localOk) {
        mode = "local-api";
        return mode;
      }
      if (hasSupabase()) {
        mode = "supabase";
        return loadSupabaseLib()
          .then(function () {
            return mode;
          })
          .catch(function () {
            mode = hasFormspree() ? "formspree" : "localStorage";
            return mode;
          });
      }
      mode = hasFormspree() ? "formspree" : "localStorage";
      return mode;
    });
    return ready;
  }

  function currentMode() {
    return mode;
  }

  function isDataUrl(src) {
    return /^data:/i.test(src || "");
  }

  function readLocalCommunity() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function writeLocalCommunity(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      try {
        var slim = (list || []).map(function (item) {
          var copy = Object.assign({}, item);
          copy.photos = (item.photos || []).map(function (p) {
            var pc = Object.assign({}, p);
            if (isDataUrl(pc.src) && (pc.src || "").length > 120000) {
              pc.src = pc.src.slice(0, 80) + "…";
            }
            return pc;
          });
          return copy;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function mineIds() {
    try {
      return JSON.parse(localStorage.getItem(MINE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function markMine(id) {
    if (!id) return;
    var ids = mineIds();
    if (ids.indexOf(id) === -1) {
      ids.push(id);
      try {
        localStorage.setItem(MINE_KEY, JSON.stringify(ids));
      } catch (e) {}
    }
  }

  function upsertLocal(entry) {
    if (!entry || !entry.id) return;
    var list = readLocalCommunity();
    var found = false;
    list = list.map(function (item) {
      if (item.id === entry.id) {
        found = true;
        return entry;
      }
      return item;
    });
    if (!found) list.unshift(entry);
    writeLocalCommunity(list);
  }

  function visibleForVisitor(item) {
    if (!item || item.status === "rejected") return false;
    if (item.status === "pending") {
      return mineIds().indexOf(item.id) !== -1;
    }
    return true;
  }

  function mergeById(lists) {
    var byId = {};
    var order = [];
    function take(item) {
      if (!item || !item.id) return;
      var existing = byId[item.id];
      if (!existing) {
        byId[item.id] = item;
        order.push(item.id);
        return;
      }
      var existingSrc = (existing.photos && existing.photos[0] && existing.photos[0].src) || "";
      var nextSrc = (item.photos && item.photos[0] && item.photos[0].src) || "";
      if (isDataUrl(existingSrc) && nextSrc && !isDataUrl(nextSrc)) {
        byId[item.id] = item;
      } else if (item.status && !existing.status) {
        byId[item.id] = item;
      } else if (item.status === "approved" && existing.status !== "approved") {
        byId[item.id] = item;
      }
    }
    (lists || []).forEach(function (list) {
      (list || []).forEach(take);
    });
    return order
      .map(function (id) {
        return byId[id];
      })
      .filter(visibleForVisitor);
  }

  function fetchJson(url, opts) {
    return fetch(url, opts || {}).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || r.statusText || "Request failed");
        return j;
      });
    });
  }

  function loadStaticApproved() {
    return fetch("data/community.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) return [];
        return r.json();
      })
      .then(function (data) {
        var list = (data && data.uploads) || [];
        return list.filter(function (item) {
          return !item.status || item.status === "approved";
        });
      })
      .catch(function () {
        return [];
      });
  }

  function loadLocalApi() {
    return fetchJson("/api/community")
      .then(function (data) {
        return data.uploads || [];
      })
      .catch(function () {
        return [];
      });
  }

  function payloadToEntry(row) {
    var entry = row.payload || {};
    if (typeof entry === "string") {
      try {
        entry = JSON.parse(entry);
      } catch (e) {
        entry = {};
      }
    }
    entry.id = row.id || entry.id;
    entry.status = row.status || entry.status;
    entry.source = "community";
    if (row.image_url && entry.photos && entry.photos[0]) {
      if (!entry.photos[0].src || isDataUrl(entry.photos[0].src)) {
        entry.photos[0].src = row.image_url;
      }
    } else if (row.image_url && (!entry.photos || !entry.photos.length)) {
      entry.photos = [{ src: row.image_url, caption: "Community find", view: "top" }];
    }
    return entry;
  }

  function loadSupabaseApproved() {
    return getSupabase()
      .then(function (client) {
        return client
          .from("community_uploads")
          .select("id,status,image_url,payload")
          .eq("status", "approved")
          .order("created_at", { ascending: false });
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return (res.data || []).map(payloadToEntry);
      })
      .catch(function () {
        return [];
      });
  }

  function loadCommunity() {
    return init().then(function () {
      var tasks = [loadStaticApproved(), Promise.resolve(readLocalCommunity())];
      if (mode === "local-api") tasks.push(loadLocalApi());
      if (mode === "supabase") tasks.push(loadSupabaseApproved());
      return Promise.all(tasks).then(function (lists) {
        return mergeById(lists);
      });
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(",");
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
    var bin = atob(parts[1] || "");
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function prepareImage(file) {
    if (!file) return Promise.reject(new Error("Please choose a photo."));
    if (file.size > 6 * 1024 * 1024) {
      return Promise.reject(new Error("Please use an image under 6 MB."));
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("Could not read that image."));
      };
      reader.onload = function () {
        var url = reader.result;
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, MAX_DIM / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
          try {
            resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
          } catch (e) {
            resolve(url);
          }
        };
        img.onerror = function () {
          resolve(url);
        };
        img.src = url;
      };
      reader.readAsDataURL(file);
    });
  }

  function newId() {
    var rand = Math.random().toString(36).slice(2, 8);
    return "c-" + Date.now() + "-" + rand;
  }

  function saveLocalApi(entry) {
    var photo = (entry.photos && entry.photos[0]) || {};
    return fetchJson("/api/community", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: entry.id,
        location: entry.location,
        notes: entry.notes || "",
        lat: photo.lat != null ? photo.lat : entry.gps && entry.gps.lat,
        lon: photo.lon != null ? photo.lon : entry.gps && entry.gps.lon,
        image: photo.src,
        entry: entry,
      }),
    }).then(function (res) {
      return res.entry;
    });
  }

  function saveSupabase(entry) {
    var photo = (entry.photos && entry.photos[0]) || {};
    if (!photo.src || !isDataUrl(photo.src)) {
      return Promise.reject(new Error("Missing image data"));
    }
    var path = "pending/" + entry.id + ".jpg";
    return getSupabase().then(function (client) {
      var blob = dataUrlToBlob(photo.src);
      return client.storage
        .from("community-photos")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false })
        .then(function (up) {
          if (up.error) throw up.error;
          var pub = client.storage.from("community-photos").getPublicUrl(path);
          var url = pub && pub.data && pub.data.publicUrl;
          var saved = JSON.parse(JSON.stringify(entry));
          saved.status = "pending";
          saved.photos[0].src = url;
          return client
            .from("community_uploads")
            .insert({
              id: saved.id,
              status: "pending",
              location: saved.location,
              notes: saved.notes || "",
              lat: saved.gps && saved.gps.lat,
              lon: saved.gps && saved.gps.lon,
              image_url: url,
              payload: saved,
            })
            .then(function (ins) {
              if (ins.error) throw ins.error;
              return saved;
            });
        });
    });
  }

  function saveUpload(entry) {
    if (!entry.id) entry.id = newId();
    entry.status = entry.status || "pending";
    entry.source = "community";
    markMine(entry.id);

    return init()
      .then(function () {
        if (mode === "local-api") return saveLocalApi(entry);
        if (mode === "supabase") return saveSupabase(entry);
        return entry;
      })
      .then(function (saved) {
        upsertLocal(saved);
        return {
          entry: saved,
          mode: mode,
          demo: mode === "localStorage" || mode === "formspree",
        };
      })
      .catch(function (err) {
        upsertLocal(entry);
        return {
          entry: entry,
          mode: "localStorage",
          demo: true,
          fallback: true,
          error: err && err.message,
        };
      });
  }

  function subscribeLocalApi(email) {
    return fetchJson("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, consent: true }),
    });
  }

  function subscribeSupabase(email) {
    return getSupabase().then(function (client) {
      return client
        .from("newsletter_signups")
        .insert({ email: email.toLowerCase(), source: "site" })
        .then(function (res) {
          if (res.error && res.error.code === "23505") return { ok: true, duplicate: true };
          if (res.error) throw res.error;
          return { ok: true };
        });
    });
  }

  function subscribeFormspree(email) {
    return fetch(cfg().formspreeNewsletter, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        consent: true,
        _subject: "Along the Trail newsletter signup",
      }),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && (j.error || j.message)) || "Formspree failed");
        return { ok: true };
      });
    });
  }

  function subscribeLocalStorage(email) {
    var list = [];
    try {
      list = JSON.parse(localStorage.getItem(NEWSLETTER_KEY) || "[]");
    } catch (e) {
      list = [];
    }
    var key = email.toLowerCase();
    if (list.indexOf(key) === -1) {
      list.push(key);
      localStorage.setItem(NEWSLETTER_KEY, JSON.stringify(list));
    }
    return { ok: true, demo: true };
  }

  function subscribeNewsletter(email) {
    email = (email || "").trim();
    return init()
      .then(function () {
        if (mode === "local-api") return subscribeLocalApi(email);
        if (mode === "supabase") return subscribeSupabase(email);
        if (hasFormspree()) return subscribeFormspree(email);
        return subscribeLocalStorage(email);
      })
      .then(function (res) {
        subscribeLocalStorage(email);
        return {
          ok: true,
          demo: mode === "localStorage" && !hasFormspree(),
          duplicate: !!(res && res.duplicate),
        };
      })
      .catch(function (err) {
        subscribeLocalStorage(email);
        return {
          ok: true,
          demo: true,
          fallback: true,
          error: err && err.message,
        };
      });
  }

  function listInbox() {
    return init().then(function () {
      var tasks = [];
      if (mode === "local-api") {
        tasks.push(
          fetchJson("/api/community-inbox", {
            headers: { "X-Admin-Token": sessionStorage.getItem("mushroom-atlas-admin-token") || "" },
          })
            .then(function (d) {
              return d.uploads || [];
            })
            .catch(function () {
              return [];
            })
        );
      }
      if (hasSupabase() && moderateSecret()) {
        tasks.push(
          getSupabase()
            .then(function (client) {
              return client.rpc("list_upload_inbox", { p_secret: moderateSecret() });
            })
            .then(function (res) {
              if (res.error) throw res.error;
              return (res.data || []).map(payloadToEntry);
            })
            .catch(function () {
              return [];
            })
        );
      }
      if (!tasks.length) return [];
      return Promise.all(tasks).then(function (lists) {
        var byId = {};
        lists.forEach(function (list) {
          (list || []).forEach(function (item) {
            if (item && item.id) byId[item.id] = item;
          });
        });
        return Object.keys(byId).map(function (k) {
          return byId[k];
        });
      });
    });
  }

  function moderate(id, action, extra) {
    extra = extra || {};
    return init().then(function () {
      var attempts = [];
      if (mode === "local-api") {
        attempts.push(
          fetchJson("/api/community-moderate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Admin-Token": sessionStorage.getItem("mushroom-atlas-admin-token") || "",
            },
            body: JSON.stringify({
              token: sessionStorage.getItem("mushroom-atlas-admin-token") || "",
              id: id,
              action: action,
              common_name: extra.common_name || "",
              scientific_name: extra.scientific_name || "",
            }),
          }).then(function (d) {
            return d.entry;
          })
        );
      }
      if (hasSupabase() && moderateSecret()) {
        attempts.push(
          getSupabase().then(function (client) {
            return client
              .rpc("moderate_upload", {
                p_id: id,
                p_status: action === "reject" ? "rejected" : "approved",
                p_secret: moderateSecret(),
                p_payload: extra.payload || null,
              })
              .then(function (res) {
                if (res.error) throw res.error;
                return payloadToEntry(res.data || { id: id, status: action });
              });
          })
        );
      }
      if (!attempts.length) return Promise.reject(new Error("No moderation backend"));
      return attempts[0];
    });
  }

  function listNewsletter() {
    return init().then(function () {
      if (mode === "local-api") {
        return fetchJson("/api/newsletter", {
          headers: { "X-Admin-Token": sessionStorage.getItem("mushroom-atlas-admin-token") || "" },
        }).then(function (d) {
          return d.signups || [];
        });
      }
      if (hasSupabase() && moderateSecret()) {
        return getSupabase()
          .then(function (client) {
            return client.rpc("list_newsletter", { p_secret: moderateSecret() });
          })
          .then(function (res) {
            if (res.error) throw res.error;
            return res.data || [];
          });
      }
      try {
        return (JSON.parse(localStorage.getItem(NEWSLETTER_KEY) || "[]") || []).map(function (email) {
          return { email: email };
        });
      } catch (e) {
        return [];
      }
    });
  }

  global.TrailPersist = {
    init: init,
    mode: currentMode,
    prepareImage: prepareImage,
    loadCommunity: loadCommunity,
    saveUpload: saveUpload,
    subscribeNewsletter: subscribeNewsletter,
    listInbox: listInbox,
    moderate: moderate,
    listNewsletter: listNewsletter,
    newId: newId,
    markMine: markMine,
    STORAGE_KEY: STORAGE_KEY,
  };
})(window);
