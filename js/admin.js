/**
 * Admin login + photo editor for the mushroom atlas.
 * LOCALHOST ONLY — never shown on GitHub Pages / public hosts.
 * Requires admin_server.py so saves write to disk.
 */
(function () {
  "use strict";

  // Public deploy (github.io, custom domain): do not load admin UI at all
  var host = (window.location.hostname || "").toLowerCase();
  var isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "";
  if (!isLocal) {
    // Remove any admin markup so it never appears on the public site
    [
      "admin-login-btn",
      "admin-bar",
      "admin-login-modal",
      "admin-inbox-modal",
      "admin-library-modal",
      "admin-editor-modal",
      "admin-server-hint",
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    return;
  }

  var TOKEN_KEY = "mushroom-atlas-admin-token";
  var token = sessionStorage.getItem(TOKEN_KEY) || "";
  var photos = [];
  var current = null; // { item, idx }
  var canvas, ctx;
  var sourceImage = null;
  var state = {
    rotation: 0, // degrees CW multiples of 90 + free
    flipH: false,
    flipV: false,
    // crop in source image pixel coords (after orientation applied to bitmap)
    crop: null, // {x,y,w,h} or null = full
  };
  var cropDrag = null;

  function $(id) {
    return document.getElementById(id);
  }

  function api(path, body, method) {
    method = method || "POST";
    var opts = {
      method: method,
      headers: { "Content-Type": "application/json" },
    };
    if (token) opts.headers["X-Admin-Token"] = token;
    if (body && method !== "GET") {
      body.token = token;
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || r.statusText);
        return j;
      });
    });
  }

  function isLoggedIn() {
    return !!token;
  }

  function setLoggedIn(t) {
    token = t || "";
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
    updateChrome();
  }

  function updateChrome() {
    var bar = $("admin-bar");
    var loginBtn = $("admin-login-btn");
    if (bar) bar.hidden = !isLoggedIn();
    if (loginBtn) loginBtn.hidden = isLoggedIn();
  }

  function bust(src) {
    if (!src) return src;
    var sep = src.indexOf("?") >= 0 ? "&" : "?";
    return src + sep + "v=" + Date.now();
  }

  function openLogin() {
    $("admin-login-modal").hidden = false;
    $("admin-password").focus();
    $("admin-login-error").textContent = "";
  }

  function closeLogin() {
    $("admin-login-modal").hidden = true;
  }

  function openLibrary() {
    if (!isLoggedIn()) {
      openLogin();
      return;
    }
    $("admin-library-modal").hidden = false;
    loadPhotos();
  }

  function closeLibrary() {
    $("admin-library-modal").hidden = true;
  }

  function openInbox() {
    if (!isLoggedIn()) {
      openLogin();
      return;
    }
    $("admin-inbox-modal").hidden = false;
    loadInbox();
  }

  function closeInbox() {
    $("admin-inbox-modal").hidden = true;
  }

  function photoSrc(item) {
    var photos = item.photos || [];
    if (photos[0] && photos[0].src) return bust(photos[0].src);
    return item.image_url || "";
  }

  function loadInbox() {
    var listEl = $("admin-inbox-list");
    var newsEl = $("admin-newsletter-list");
    if (listEl) listEl.innerHTML = "<p class='admin-loading'>Loading uploads…</p>";
    if (newsEl) newsEl.innerHTML = "<p class='admin-loading'>Loading signups…</p>";

    var uploads = window.TrailPersist
      ? TrailPersist.listInbox()
      : api("/api/community-inbox", null, "GET").then(function (d) {
          return d.uploads || [];
        });
    var signups = window.TrailPersist
      ? TrailPersist.listNewsletter()
      : api("/api/newsletter", null, "GET").then(function (d) {
          return d.signups || [];
        });

    uploads
      .then(function (items) {
        if (!listEl) return;
        if (!items.length) {
          listEl.innerHTML = "<p class='admin-help'>No pending community uploads.</p>";
          return;
        }
        listEl.innerHTML = items
          .map(function (item) {
            var status = item.status || "pending";
            return (
              '<article class="admin-inbox-card" data-id="' +
              escapeHtml(item.id) +
              '">' +
              (photoSrc(item)
                ? '<img src="' + photoSrc(item) + '" alt="" />'
                : '<div class="admin-inbox-missing">No image</div>') +
              '<div class="admin-inbox-meta">' +
              "<strong>" +
              escapeHtml(item.common_name || "Unidentified find") +
              "</strong>" +
              "<span>" +
              escapeHtml(item.location || "") +
              "</span>" +
              "<span>" +
              escapeHtml(item.notes || "") +
              "</span>" +
              '<span class="admin-inbox-status">' +
              escapeHtml(status) +
              " · " +
              escapeHtml((item.uploaded_at || "").slice(0, 10)) +
              "</span>" +
              '<label>Name <input type="text" class="admin-inbox-name" placeholder="Optional ID" /></label>' +
              '<div class="admin-inbox-actions">' +
              '<button type="button" class="btn btn-primary btn-inline" data-act="approve">Approve</button>' +
              '<button type="button" class="btn btn-ghost btn-inline" data-act="reject">Reject</button>' +
              "</div></div></article>"
            );
          })
          .join("");
        listEl.querySelectorAll(".admin-inbox-card").forEach(function (card) {
          card.querySelectorAll("[data-act]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = card.getAttribute("data-id");
              var action = btn.getAttribute("data-act");
              var nameInput = card.querySelector(".admin-inbox-name");
              btn.disabled = true;
              var extra = { common_name: nameInput ? nameInput.value.trim() : "" };
              var job = window.TrailPersist
                ? TrailPersist.moderate(id, action, extra)
                : api("/api/community-moderate", {
                    id: id,
                    action: action,
                    common_name: extra.common_name,
                  });
              job
                .then(function () {
                  loadInbox();
                })
                .catch(function (err) {
                  btn.disabled = false;
                  alert(err.message || "Moderation failed");
                });
            });
          });
        });
      })
      .catch(function (err) {
        if (listEl) {
          listEl.innerHTML =
            "<p class='admin-error'>" + escapeHtml(err.message || "Could not load inbox") + "</p>";
        }
      });

    signups
      .then(function (rows) {
        if (!newsEl) return;
        if (!rows.length) {
          newsEl.innerHTML = "<p class='admin-help'>No newsletter signups yet.</p>";
          return;
        }
        newsEl.innerHTML =
          "<ul>" +
          rows
            .map(function (row) {
              var email = typeof row === "string" ? row : row.email;
              var when = row && row.consented_at ? String(row.consented_at).slice(0, 10) : "";
              return (
                "<li><code>" +
                escapeHtml(email) +
                "</code>" +
                (when ? " · " + escapeHtml(when) : "") +
                "</li>"
              );
            })
            .join("") +
          "</ul>";
      })
      .catch(function (err) {
        if (newsEl) {
          newsEl.innerHTML =
            "<p class='admin-error'>" + escapeHtml(err.message || "Could not load signups") + "</p>";
        }
      });
  }

  function openEditor(item) {
    current = item;
    $("admin-editor-modal").hidden = false;
    $("admin-editor-title").textContent =
      (item.group_name || "") + " — " + (item.caption || item.src);
    $("admin-editor-status").textContent = "";
    state = { rotation: 0, flipH: false, flipV: false, crop: null };
    cropDrag = null;
    loadImageToCanvas(item.src);
  }

  function closeEditor() {
    $("admin-editor-modal").hidden = true;
    sourceImage = null;
    current = null;
  }

  function loadPhotos() {
    var grid = $("admin-photo-grid");
    grid.innerHTML = "<p class='admin-loading'>Loading photos…</p>";
    api("/api/photos", null, "GET")
      .catch(function () {
        // GET with token header only
        return fetch("/api/photos", {
          headers: { "X-Admin-Token": token },
        }).then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error(j.error || "Failed");
            return j;
          });
        });
      })
      .then(function (data) {
        photos = data.photos || [];
        var filter = ($("admin-filter-group") || {}).value || "all";
        var list = photos.filter(function (p) {
          return filter === "all" || p.group_id === filter;
        });
        // Populate filter options once
        var sel = $("admin-filter-group");
        if (sel && sel.options.length <= 1) {
          var seen = {};
          photos.forEach(function (p) {
            if (!seen[p.group_id]) {
              seen[p.group_id] = p.group_name;
            }
          });
          Object.keys(seen).forEach(function (id) {
            var opt = document.createElement("option");
            opt.value = id;
            opt.textContent = seen[id];
            sel.appendChild(opt);
          });
        }
        grid.innerHTML = list
          .map(function (p, i) {
            var name =
              (p.id_detail && p.id_detail.common_name) || p.caption || "Photo";
            return (
              '<button type="button" class="admin-thumb' +
              (p.is_cover ? " is-cover" : "") +
              '" data-idx="' +
              photos.indexOf(p) +
              '">' +
              '<img src="' +
              bust(p.src) +
              '" alt="" />' +
              '<span class="admin-thumb-meta"><strong>' +
              escapeHtml(p.group_name) +
              "</strong>" +
              escapeHtml(name) +
              (p.is_cover ? " · Cover" : "") +
              "</span></button>"
            );
          })
          .join("");
        grid.querySelectorAll(".admin-thumb").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var idx = parseInt(btn.getAttribute("data-idx"), 10);
            openEditor(photos[idx]);
          });
        });
      })
      .catch(function (err) {
        grid.innerHTML =
          "<p class='admin-error'>" +
          escapeHtml(err.message) +
          ". Use <code>python3 admin_server.py</code> so the admin API is available.</p>";
      });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadImageToCanvas(src) {
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      sourceImage = img;
      state.crop = null;
      redraw();
    };
    img.onerror = function () {
      $("admin-editor-status").textContent = "Could not load image.";
    };
    img.src = bust(src);
  }

  function transformedSize() {
    if (!sourceImage) return { w: 0, h: 0 };
    var w = sourceImage.naturalWidth;
    var h = sourceImage.naturalHeight;
    var r = ((state.rotation % 360) + 360) % 360;
    if (r === 90 || r === 270) return { w: h, h: w };
    return { w: w, h: h };
  }

  function redraw() {
    if (!sourceImage || !canvas) return;
    var size = transformedSize();
    var maxW = Math.min(900, window.innerWidth - 48);
    var maxH = Math.min(520, window.innerHeight - 220);
    var scale = Math.min(maxW / size.w, maxH / size.h, 1);
    var dw = Math.round(size.w * scale);
    var dh = Math.round(size.h * scale);
    canvas.width = dw;
    canvas.height = dh;
    canvas.dataset.scale = String(scale);
    canvas.dataset.fullW = String(size.w);
    canvas.dataset.fullH = String(size.h);

    ctx.save();
    ctx.clearRect(0, 0, dw, dh);
    ctx.translate(dw / 2, dh / 2);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
    ctx.drawImage(
      sourceImage,
      -sourceImage.naturalWidth / 2,
      -sourceImage.naturalHeight / 2
    );
    ctx.restore();

    // Crop overlay in canvas display coords
    if (state.crop) {
      var s = scale;
      var c = state.crop;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, dw, dh);
      ctx.clearRect(c.x * s, c.y * s, c.w * s, c.h * s);
      ctx.strokeStyle = "#e8c4a0";
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x * s, c.y * s, c.w * s, c.h * s);
      ctx.restore();
    }
  }

  function getExportCanvas() {
    if (!sourceImage) return null;
    var size = transformedSize();
    var full = document.createElement("canvas");
    full.width = size.w;
    full.height = size.h;
    var fctx = full.getContext("2d");
    fctx.translate(size.w / 2, size.h / 2);
    fctx.rotate((state.rotation * Math.PI) / 180);
    fctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
    fctx.drawImage(
      sourceImage,
      -sourceImage.naturalWidth / 2,
      -sourceImage.naturalHeight / 2
    );

    if (!state.crop) return full;
    var c = state.crop;
    var out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(c.w));
    out.height = Math.max(1, Math.round(c.h));
    out
      .getContext("2d")
      .drawImage(full, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
    return out;
  }

  function setupCropDrag() {
    canvas.addEventListener("mousedown", function (e) {
      if (!$("admin-crop-mode").checked) return;
      var rect = canvas.getBoundingClientRect();
      var scale = parseFloat(canvas.dataset.scale || "1");
      var x = (e.clientX - rect.left) / scale;
      var y = (e.clientY - rect.top) / scale;
      cropDrag = { x0: x, y0: y };
      state.crop = { x: x, y: y, w: 1, h: 1 };
      redraw();
    });
    window.addEventListener("mousemove", function (e) {
      if (!cropDrag || !$("admin-crop-mode").checked) return;
      var rect = canvas.getBoundingClientRect();
      var scale = parseFloat(canvas.dataset.scale || "1");
      var x = (e.clientX - rect.left) / scale;
      var y = (e.clientY - rect.top) / scale;
      var x0 = cropDrag.x0;
      var y0 = cropDrag.y0;
      state.crop = {
        x: Math.min(x0, x),
        y: Math.min(y0, y),
        w: Math.abs(x - x0),
        h: Math.abs(y - y0),
      };
      redraw();
    });
    window.addEventListener("mouseup", function () {
      cropDrag = null;
    });
  }

  function wire() {
    canvas = $("admin-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    setupCropDrag();

    $("admin-login-btn").addEventListener("click", openLogin);
    $("admin-open-library").addEventListener("click", openLibrary);
    if ($("admin-open-inbox")) {
      $("admin-open-inbox").addEventListener("click", openInbox);
    }
    $("admin-logout").addEventListener("click", function () {
      api("/api/logout", { token: token }).catch(function () {});
      setLoggedIn("");
      closeLibrary();
      closeInbox();
      closeEditor();
    });

    $("admin-login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = $("admin-password").value;
      $("admin-login-error").textContent = "";
      api("/api/login", { password: pw })
        .then(function (res) {
          setLoggedIn(res.token);
          closeLogin();
          openLibrary();
        })
        .catch(function (err) {
          $("admin-login-error").textContent = err.message || "Login failed";
        });
    });

    document.querySelectorAll("[data-admin-close]").forEach(function (el) {
      el.addEventListener("click", function () {
        var t = el.getAttribute("data-admin-close");
        if (t === "login") closeLogin();
        if (t === "library") closeLibrary();
        if (t === "inbox") closeInbox();
        if (t === "editor") closeEditor();
      });
    });

    $("admin-filter-group").addEventListener("change", loadPhotos);

    $("admin-rot-left").addEventListener("click", function () {
      state.rotation = (state.rotation - 90 + 360) % 360;
      state.crop = null;
      redraw();
    });
    $("admin-rot-right").addEventListener("click", function () {
      state.rotation = (state.rotation + 90) % 360;
      state.crop = null;
      redraw();
    });
    $("admin-flip-h").addEventListener("click", function () {
      state.flipH = !state.flipH;
      redraw();
    });
    $("admin-flip-v").addEventListener("click", function () {
      state.flipV = !state.flipV;
      redraw();
    });
    $("admin-reset").addEventListener("click", function () {
      state = { rotation: 0, flipH: false, flipV: false, crop: null };
      redraw();
    });
    $("admin-clear-crop").addEventListener("click", function () {
      state.crop = null;
      $("admin-crop-mode").checked = false;
      redraw();
    });

    $("admin-save").addEventListener("click", function () {
      if (!current) return;
      var exp = getExportCanvas();
      if (!exp) return;
      $("admin-editor-status").textContent = "Saving…";
      var dataUrl = exp.toDataURL("image/jpeg", 0.92);
      api("/api/save-image", { path: current.src, image: dataUrl })
        .then(function () {
          $("admin-editor-status").textContent = "Saved to disk.";
          // refresh thumbnail in library
          loadImageToCanvas(current.src);
          // refresh public gallery cards if present
          var imgs = document.querySelectorAll('img[src*="' + current.src.split("/").pop() + '"]');
          imgs.forEach(function (img) {
            img.src = bust(current.src);
          });
          setTimeout(loadPhotos, 300);
        })
        .catch(function (err) {
          $("admin-editor-status").textContent = err.message;
        });
    });

    $("admin-set-cover").addEventListener("click", function () {
      if (!current) return;
      $("admin-editor-status").textContent = "Setting cover…";
      api("/api/set-cover", { group_id: current.group_id, path: current.src })
        .then(function () {
          $("admin-editor-status").textContent = "Cover updated. Refresh gallery if needed.";
          loadPhotos();
          // soft reload catalog view
          if (typeof location !== "undefined") {
            /* gallery reads cover from json — reload page section */
          }
          // Force catalog refresh by reloading page data
          setTimeout(function () {
            window.location.reload();
          }, 600);
        })
        .catch(function (err) {
          $("admin-editor-status").textContent = err.message;
        });
    });

    // Health check: only show Admin when local admin_server.py is running
    fetch("/api/health")
      .then(function (r) {
        return r.json();
      })
      .then(function () {
        if ($("admin-login-btn")) $("admin-login-btn").hidden = false;
        if ($("admin-server-hint")) $("admin-server-hint").hidden = true;
      })
      .catch(function () {
        if ($("admin-login-btn")) $("admin-login-btn").hidden = true;
        if ($("admin-server-hint")) $("admin-server-hint").hidden = false;
      });

    updateChrome();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
