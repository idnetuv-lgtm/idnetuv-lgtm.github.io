// Bootstrap: prevent early ReferenceError by providing minimal dataStore and placeholders.
window.dataStore = window.dataStore || { profile: {}, profileSnapshots: {}, posts: {} };
(function () {
    const placeholderNames = [
        'renderPostVariantsForDate', 'getVariantsForDate', 'parseTagsFromString', 'buildProfileURL', 'buildProfileText',
        'renderProfileInputs', 'renderUsernameAreas', 'renderTagCloud', 'renderTableFiltered', 'renderTableFilteredSorted',
        'generateMonthOptions', 'generateProfileMonthOptions', 'loadJson', 'saveData', 'deleteData', 'saveProfileSnapshot',
        'updateMonthlyReachDisplay', 'updateMonthlyImpressionsDisplay', 'editData', 'deleteProfileSnapshot'
    ];
    placeholderNames.forEach(n => {
        if (typeof window[n] !== 'function') window[n] = function () { /* placeholder */ };
    });
})();

(function () {
    // default store
    window.dataStore = window.dataStore || {
        profile: { username: "", followersStart: 0, followersEnd: 0, ageRange: { "18-24": 0, "25-34": 0, "35-44": 0, "45-54": 0, "55-64": 0 }, gender: { male: 0, female: 0 } },
        profileSnapshots: {},
        posts: {}
    };

    // helpers
    function normalizeUsername(raw) { return raw ? String(raw).trim().replace(/^@+/, "") : ""; }
    function buildProfileURL(u) { return u ? "https://instagram.com/" + normalizeUsername(u) : ""; }
    function buildProfileText(u) { return u ? "@" + normalizeUsername(u) : ""; }
    function parseTagsFromString(s) {
        if (!s) return [];
        return String(s).split(/[,;]+|\s+/).map(t => t.replace(/^#+/, '').trim().toLowerCase()).filter(Boolean);
    }
    window.parseTagsFromString = parseTagsFromString;

    function extractHashtags(text) {
        if (!text) return [];
        // Regex to find #word (letters, numbers, underscores). limits to standard hashtags.
        // Support unicode letters if needed, but \w is usually [a-zA-Z0-9_] which is safe for basic tags.
        const matches = text.match(/#[\w\u00C0-\u00FF]+/g);
        if (!matches) return [];
        // Remove # and return unique clean tags
        return [...new Set(matches.map(t => t.slice(1).toLowerCase()))];
    }
    window.extractHashtags = extractHashtags;

    function regenerateAllTags() {
        let count = 0;
        Object.keys(window.dataStore.posts || {}).forEach(date => {
            const p = window.dataStore.posts[date] || {};
            const items = Array.isArray(p._items) ? p._items : [];
            items.forEach(item => {
                const notes = item.notes || item.contentNotes || "";
                if (notes) {
                    const extracted = extractHashtags(notes);
                    if (extracted.length > 0) {
                        const currentTags = Array.isArray(item.tags) ? item.tags : [];
                        const merged = [...new Set([...currentTags, ...extracted])];
                        // check if changed
                        if (merged.length !== currentTags.length) {
                            item.tags = merged;
                            item.tag = merged.join(' '); // sync legacy field
                            count++;
                        }
                    }
                }
            });
        });

        if (count > 0) {
            renderTableFiltered();
            renderTagCloud();
            // populate form if selected
            const currentDate = document.getElementById('dateInput')?.value;
            if (currentDate) populateFormFromSelected(currentDate, window.currentPostIndex || 0);

            showSaveNotification(`Tags regenerated for ${count} posts!`);
        } else {
            alert("No new tags found in captions.");
        }
    }
    window.regenerateAllTags = regenerateAllTags;

    // normalize posts structure to use _items []
    function normalizePostsStructure() {
        const out = {};
        Object.keys(window.dataStore.posts || {}).forEach(date => {
            const p = window.dataStore.posts[date] || {};
            // if already normalized
            if (Array.isArray(p._items)) {
                // ensure numeric normalization and tags array
                p._items = p._items.map(v => normalizeItem(v));
                out[date] = p;
                return;
            }
            // legacy: main object + optional _variants array -> convert
            const items = [];
            const main = Object.assign({}, p);
            // remove _variants if present on main
            const variants = Array.isArray(main._variants) ? main._variants : (Array.isArray(p._variants) ? p._variants : []);
            if (main._variants) delete main._variants;
            // main may contain title/link etc; if it has only _variants and no fields, main item may be empty -> still push
            items.push(normalizeItem(main));
            (variants || []).forEach(v => { items.push(normalizeItem(v)); });
            out[date] = { _items: items };
        });
        window.dataStore.posts = out;
    }

    function normalizeItem(v) {
        v = Object.assign({}, v || {});
        const fieldsToNormalize = [
            'reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'postInteractions', 'reelsInteractions', 'profileActivity',
            'profileVisits', 'follows', 'externalLinkTaps', 'businessAddressTaps', 'messagingConversationsStarted',
            'viewFollowersPercentage', 'viewNonFollowersPercentage',
            'intFollowersPercentage', 'intNonFollowersPercentage'
        ];
        fieldsToNormalize.forEach(field => {
            v[field] = +v[field] || 0;
        });

        v.engagement = v.reach > 0 ? (((v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0)) / v.reach * 100) : 0;
        if (!Array.isArray(v.tags)) v.tags = v.tag ? parseTagsFromString(v.tag) : [];
        v.title = v.title || "";
        v.notes = v.notes || "";
        v.lastEdited = v.lastEdited || v._lastEdited || null;
        return v;
    }

    // ensure initial normalization
    normalizePostsStructure();

    // items API (compatibility with previous getVariantsForDate)
    function getVariantsForDate(date) {
        // returns array of { title, data, isMain } compatible with previous API
        const base = window.dataStore.posts[date] || { _items: [] };
        const arr = Array.isArray(base._items) ? base._items : [];
        return arr.map((it, i) => ({ title: it.title || `Post ${i + 1}`, data: it, isMain: i === 0 }));
    }
    window.getVariantsForDate = getVariantsForDate;

    // Post items list UI
    window.currentPostIndex = 0;
    function renderPostVariantsForDate(date) {
        // compatibility wrapper -> call new renderer
        renderPostItemsForDate(date);
    }
    window.renderPostVariantsForDate = renderPostVariantsForDate;

    function renderPostItemsForDate(date) {
        const container = document.getElementById('postItemsList');
        if (!container) return;
        container.innerHTML = '';
        if (!date) { container.innerHTML = '<span class="muted">(Pilih tanggal untuk melihat post)</span>'; return; }
        const obj = window.dataStore.posts[date] || { _items: [] };
        if (!Array.isArray(obj._items)) obj._items = [];
        // render each item
        obj._items.forEach((item, idx) => {
            const span = document.createElement('button');
            span.className = 'post-item' + (idx === window.currentPostIndex ? ' active' : '');
            span.setAttribute('data-idx', idx);
            span.title = item.title || `Post ${idx + 1}`;
            span.innerHTML = `<span style="font-size:11px;color:rgba(0,0,0,0.6);">#${idx + 1}</span><span class="title">${escapeHtml(item.title || ('Post ' + (idx + 1)))}</span>`;
            span.addEventListener('click', function (e) {
                const i = parseInt(this.getAttribute('data-idx'), 10);
                selectPostIndex(i);
            });
            // small delete button
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-small';
            delBtn.innerHTML = '✕';
            delBtn.title = 'Hapus post ini';
            delBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (!confirm('Hapus post #' + (idx + 1) + ' pada ' + date + ' ?')) return;
                deletePostItem(date, idx);
            });
            span.appendChild(delBtn);
            container.appendChild(span);
        });
        // if no items show placeholder
        if (!obj._items.length) container.innerHTML = '<span class="muted">(Belum ada post pada tanggal ini)</span>';
        // update newPostTitle placeholder
        document.getElementById('newPostTitle').value = '';
        // ensure current index valid
        if (window.currentPostIndex >= (obj._items.length || 0)) window.currentPostIndex = Math.max(0, (obj._items.length || 0) - 1);
        // apply active class after rendering
        Array.from(container.querySelectorAll('.post-item')).forEach(el => el.classList.toggle('active', parseInt(el.getAttribute('data-idx'), 10) === window.currentPostIndex));
    }

    function selectPostIndex(idx) {
        const date = document.getElementById('dateInput')?.value;
        if (!date) return alert('Pilih tanggal terlebih dahulu.');
        const obj = window.dataStore.posts[date] || { _items: [] };
        if (!Array.isArray(obj._items)) obj._items = [];
        if (idx < 0 || idx >= obj._items.length) return;
        window.currentPostIndex = idx;
        renderPostItemsForDate(date);
        populateFormFromSelected(date, idx);
    }

    function populateFormFromSelected(date, idx) {
        const obj = window.dataStore.posts[date] || { _items: [] };
        const v = obj._items[idx] || {};
        const fields = [
            'link', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves',
            'postInteractions', 'reelsInteractions', 'profileActivity',
            'profileVisits', 'follows', 'externalLinkTaps', 'businessAddressTaps', 'messagingConversationsStarted',
            'viewFollowersPercentage', 'viewNonFollowersPercentage',
            'intFollowersPercentage', 'intNonFollowersPercentage'
        ];
        fields.forEach(field => {
            const element = document.getElementById(field);
            if (element) {
                // For number inputs, ensure 0 is displayed if the value is 0 or falsy.
                // For other input types, display the value or an empty string.
                if (element.type === 'number') {
                    element.value = (v[field] === 0 || v[field]) ? v[field] : 0;
                } else {
                    element.value = v[field] || "";
                }
            }
        });
        // Perbaikan Bug Caption: Secara eksplisit memuat data 'notes'
        document.getElementById("contentNotes").value = v.notes || v.contentNotes || "";

        document.getElementById("contentTag").value = (v.tags && v.tags.length) ? v.tags.join(', ') : (v.tag || '');
        document.getElementById("newPostTitle").value = v.title || "";
        updateLastEditedDisplay(v.lastEdited || null);
        updateEngagement();
    }

    function addPostItem() {
        const date = document.getElementById("dateInput")?.value;
        if (!date) { alert("Silakan pilih tanggal terlebih dahulu."); return; }
        if (!window.dataStore.posts[date]) window.dataStore.posts[date] = { _items: [] };
        if (!Array.isArray(window.dataStore.posts[date]._items)) window.dataStore.posts[date]._items = [];
        let rawTitle = (document.getElementById("newPostTitle")?.value || "").trim();
        // fallback to "Post N"
        if (!rawTitle) rawTitle = 'Post ' + (window.dataStore.posts[date]._items.length + 1);
        // ensure unique title among items for this date
        const existing = window.dataStore.posts[date]._items.map(it => (it.title || '').trim().toLowerCase());
        let uniqueTitle = rawTitle;
        let counter = 2;
        while (existing.includes(uniqueTitle.toLowerCase())) {
            uniqueTitle = rawTitle + " (" + counter + ")";
            counter++;
        }
        const newItem = normalizeItem({
            title: uniqueTitle,
            lastEdited: new Date().toISOString()
        });
        window.dataStore.posts[date]._items.push(newItem);
        window.currentPostIndex = window.dataStore.posts[date]._items.length - 1;
        renderPostItemsForDate(date);
        populateFormFromSelected(date, window.currentPostIndex);
        showSaveNotification("Post baru dibuat untuk " + date + " — " + uniqueTitle);
    }
    window.addPostItem = addPostItem;

    function deletePostItem(date, idx) {
        if (!date || !window.dataStore.posts[date]) return;
        const arr = window.dataStore.posts[date]._items || [];
        if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
        arr.splice(idx, 1);
        if (!arr.length) delete window.dataStore.posts[date];
        else window.dataStore.posts[date]._items = arr;
        // adjust currentPostIndex
        window.currentPostIndex = Math.max(0, Math.min(window.currentPostIndex, (window.dataStore.posts[date]?._items?.length || 0) - 1));
        generateMonthOptions();
        renderTableFiltered();
        renderTagCloud();
        renderPostItemsForDate(date);
    }

    // tag cloud & selection
    window.selectedTags = window.selectedTags || new Set();

    function renderTagCloud() {
        const cloud = document.getElementById('tagCloud');
        if (!cloud) return;
        const counts = {};
        Object.keys(dataStore.posts || {}).forEach(k => {
            const p = dataStore.posts[k] || {};
            const items = Array.isArray(p._items) ? p._items : [];
            items.forEach(item => {
                const coll = Array.isArray(item.tags) ? item.tags : (item.tag ? parseTagsFromString(item.tag) : []);
                coll.forEach(t => counts[t] = (counts[t] || 0) + 1);
            });
        });
        cloud.innerHTML = "";
        const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        if (!keys.length) { cloud.innerHTML = '<span class="muted">(Belum ada tag)</span>'; return; }
        keys.forEach(t => {
            const sp = document.createElement('span');
            sp.className = 'badge' + (window.selectedTags.has(t) ? ' active' : '');
            sp.setAttribute('data-tag', t);
            sp.innerHTML = '#' + t + '<span class="tag-count">(' + counts[t] + ')</span>';
            sp.addEventListener('click', function () {
                if (window.selectedTags.has(t)) window.selectedTags.delete(t);
                else window.selectedTags.add(t);
                // sync input
                const tf = document.getElementById('tagFilter');
                if (tf) tf.value = Array.from(window.selectedTags).join(' ');
                // rerender table & cloud
                renderTableFilteredSorted();
                renderTagCloud();
            });
            cloud.appendChild(sp);
        });
    }
    window.renderTagCloud = renderTagCloud;

    function selectTagFromTable(tag) {
        // when clicking a tag inside table, set it as single selected tag and update UI
        window.selectedTags = new Set([tag]);
        const tf = document.getElementById('tagFilter');
        if (tf) tf.value = tag;
        renderTableFilteredSorted();
        renderTagCloud();
    }

    // months dropdowns
    function generateMonthOptions() {
        const select = document.getElementById("monthFilter");
        if (!select) return;
        const prev = select.value || "all";
        select.innerHTML = '<option value="all">Semua</option>';
        const set = new Set();
        Object.keys(dataStore.posts || {}).forEach(d => { if (d && d.length >= 7) set.add(d.slice(0, 7)); });
        Array.from(set).sort().forEach(m => {
            const opt = document.createElement('option'); opt.value = m; opt.textContent = m; select.appendChild(opt);
        });
        if ([...select.options].some(o => o.value === prev)) select.value = prev;
        // also update profileMonthForReach if exists
        const select2 = document.getElementById("profileMonthForReach");
        if (select2) {
            const prev2 = select2.value || "all";
            select2.innerHTML = '<option value="all">Semua</option>';
            Array.from(set).sort().forEach(m => { const opt = document.createElement('option'); opt.value = m; opt.textContent = m; select2.appendChild(opt); });
            if ([...select2.options].some(o => o.value === prev2)) select2.value = prev2;
        }
        // update KPI cards when month options change
        try { updateMonthlyMetricsDisplay(); } catch (e) { }
    }
    window.generateMonthOptions = generateMonthOptions;

    // generic monthly sum calculator for any numeric field
    function calculateMonthlySum(field, month) {
        let total = 0;
        Object.keys(dataStore.posts || {}).forEach(d => {
            if (!d) return;
            if (month && month !== 'all' && !d.startsWith(month)) return;
            const p = dataStore.posts[d] || {};
            const items = Array.isArray(p._items) ? p._items : [];
            items.forEach(it => { total += +(it[field] || 0); });
        });
        return total;
    }

    function updateMonthlyMetricsDisplay() {
        const sel = document.getElementById('monthFilter');
        const month = sel ? sel.value : 'all';
        // map fields to element ids
        const map = [
            { id: 'monthlyReachTotal', field: 'reach' },
            { id: 'monthlyImpressionsTotal', field: 'impressions' },
            { id: 'monthlyLikesTotal', field: 'likes' },
            { id: 'monthlyCommentsTotal', field: 'comments' },
            { id: 'monthlySharesTotal', field: 'shares' },
            { id: 'monthlySavesTotal', field: 'saves' },
            { id: 'monthlyWebsiteClicksTotal', field: 'externalLinkTaps' }
        ];
        map.forEach(m => {
            const el = document.getElementById(m.id);
            if (!el) return;
            const val = calculateMonthlySum(m.field, month);
            // format with thousands separator
            el.innerText = (typeof val === 'number') ? val.toLocaleString() : '0';
        });
    }
    window.updateMonthlyMetricsDisplay = updateMonthlyMetricsDisplay;

    // update when month filter changes
    (function attachMonthFilterListener() {
        const el = document.getElementById('monthFilter');
        if (!el) return;
        el.addEventListener('change', function () {
            try { updateMonthlyMetricsDisplay(); } catch (e) { }
            try { updateMonthlyReachDisplay(); updateMonthlyImpressionsDisplay(); } catch (e) { }
        });
    })();

    // delete posts by selected month (or all)
    function deletePostsByMonth() {
        const sel = document.getElementById('monthFilter');
        if (!sel) return alert('Tidak menemukan kontrol filter bulan.');
        const month = sel.value;
        if (!month) return alert('Pilih bulan terlebih dahulu.');
        const confirmMsg = (month === 'all')
            ? 'Hapus SEMUA data pada database? Tindakan ini tidak dapat dibatalkan. Lanjutkan?'
            : 'Hapus semua post untuk bulan ' + month + '? Tindakan ini tidak dapat dibatalkan. Lanjutkan?';
        if (!confirm(confirmMsg)) return;

        const keys = Object.keys(window.dataStore.posts || {});
        let removed = 0;
        keys.forEach(k => {
            if (month === 'all' || (k && k.indexOf(month) === 0)) {
                delete window.dataStore.posts[k];
                removed++;
            }
        });

        // refresh UI and options
        try { generateMonthOptions(); } catch (e) { }
        if (typeof renderTableFilteredSorted === 'function') renderTableFilteredSorted();
        else if (typeof renderTableFiltered === 'function') renderTableFiltered();
        try { renderTagCloud(); } catch (e) { }
        try { updateMonthlyMetricsDisplay(); } catch (e) { }

        if (removed) alert('Berhasil menghapus data untuk ' + removed + ' tanggal.');
        else alert('Tidak ada data yang dihapus untuk pilihan ini.');

        if (typeof saveData === 'function') {
            try { saveData(); } catch (e) { }
        }
    }
    window.deletePostsByMonth = deletePostsByMonth;

    function generateProfileMonthOptions() {
        const select = document.getElementById("profileMonthFilter");
        if (!select) return;
        const prev = select.value || "all";
        select.innerHTML = '<option value="all">Semua</option>';
        const set = new Set();
        Object.keys(dataStore.posts || {}).forEach(d => { if (d && d.length >= 7) set.add(d.slice(0, 7)); });
        Object.keys(dataStore.profileSnapshots || {}).forEach(m => set.add(m));
        Array.from(set).sort().forEach(m => { const opt = document.createElement('option'); opt.value = m; opt.textContent = m; select.appendChild(opt); });
        if ([...select.options].some(o => o.value === prev)) select.value = prev;
    }
    window.generateProfileMonthOptions = generateProfileMonthOptions;


    // monthly totals
    function calculateMonthlyReach(month) {
        let total = 0;
        Object.keys(dataStore.posts || {}).forEach(d => { if (!d) return; if (month && month !== "all" && !d.startsWith(month)) return; const p = dataStore.posts[d] || {}; const items = Array.isArray(p._items) ? p._items : []; items.forEach(it => { total += +(it.reach || 0); }); });
        return total;
    }
    function calculateMonthlyImpressions(month) {
        let total = 0;
        Object.keys(dataStore.posts || {}).forEach(d => { if (!d) return; if (month && month !== "all" && !d.startsWith(month)) return; const p = dataStore.posts[d] || {}; const items = Array.isArray(p._items) ? p._items : []; items.forEach(it => { total += +(it.impressions || 0); }); });
        return total;
    }
    function updateMonthlyReachDisplay() {
        const sel = document.getElementById("monthFilter") || document.getElementById("profileMonthFilter");
        const month = sel ? sel.value : "all";
        const el = document.getElementById("monthlyReachTotal");
        if (el) el.innerText = calculateMonthlyReach(month).toLocaleString();
    }
    function updateMonthlyImpressionsDisplay() {
        const sel = document.getElementById("monthFilter") || document.getElementById("profileMonthFilter");
        const month = sel ? sel.value : "all";
        const el = document.getElementById("monthlyImpressionsTotal");
        if (el) el.innerText = calculateMonthlyImpressions(month).toLocaleString();
    }

    // profile inputs
    function renderProfileInputs() {
        const p = dataStore.profile || {};
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v === undefined || v === null) ? 0 : v; };
        if (document.getElementById("username")) document.getElementById("username").value = p.username || "";
        // Default: followersStart editable when no snapshot selected; renderProfileInputs used for 'all' state
        const fs = document.getElementById("followersStart");
        const fe = document.getElementById("followersEnd");
        if (fs) { fs.value = (p.followersStart || 0); fs.disabled = false; }
        if (fe) { fe.value = (p.followersEnd || 0); fe.disabled = false; }
        setVal("age18_24", p.ageRange?.["18-24"] || 0);
        setVal("age25_34", p.ageRange?.["25-34"] || 0);
        setVal("age35_44", p.ageRange?.["35-44"] || 0);
        setVal("age45_54", p.ageRange?.["45-54"] || 0);
        setVal("age55_64", p.ageRange?.["55-64"] || 0);
        setVal("male", p.gender?.male || 0);
        setVal("female", p.gender?.female || 0);
        renderUsernameAreas();
    }

    function renderUsernamePreview() {
        const u = document.getElementById("username") ? document.getElementById("username").value : "";
        const preview = document.getElementById("usernamePreview");
        if (preview) preview.textContent = buildProfileText(u) || "(belum diisi)";
    }

    function renderUsernameAreas() {
        const p = dataStore.profile || {};
        const uname = p.username || (document.getElementById('username')?.value || "");
        const linkSpan = document.getElementById('igProfileLink');
        if (!linkSpan) return;
        if (uname) {
            const url = buildProfileURL(uname);
            const text = buildProfileText(uname);
            linkSpan.innerHTML = `<a href="${url}" target="_blank">${text}</a>`;
        } else linkSpan.textContent = "(belum diisi)";
        renderUsernamePreview();
    }

    function updateProfile() {
        dataStore.profile.username = normalizeUsername(document.getElementById("username")?.value || "");
        dataStore.profile.followersStart = +document.getElementById("followersStart")?.value || 0;
        dataStore.profile.followersEnd = +document.getElementById("followersEnd")?.value || 0;
        dataStore.profile.ageRange["18-24"] = +document.getElementById("age18_24")?.value || 0;
        dataStore.profile.ageRange["25-34"] = +document.getElementById("age25_34")?.value || 0;
        dataStore.profile.ageRange["35-44"] = +document.getElementById("age35_44")?.value || 0;
        dataStore.profile.ageRange["45-54"] = +document.getElementById("age45_54")?.value || 0;
        dataStore.profile.ageRange["55-64"] = +document.getElementById("age55_64")?.value || 0;
        dataStore.profile.gender.male = +document.getElementById("male")?.value || 0;
        dataStore.profile.gender.female = +document.getElementById("female")?.value || 0;

        const start = dataStore.profile.followersStart || 0;
        const end = dataStore.profile.followersEnd || 0;
        const growth = end - start;
        const growthRate = start > 0 ? (growth / start) * 100 : 0;

        const setText = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        setText("followerGrowth", growth);
        setText("growthRate", growthRate.toFixed(1) + "%");

        // --- ADVANCED INTERACTIVE CHART ---
        renderAdvancedChart();

        updateMonthlyReachDisplay();
        updateMonthlyImpressionsDisplay();
        renderUsernameAreas();
    }

    // --- CHART LOGIC ---
    const chartMetricsConfig = [
        { key: 'reach', label: 'Reach', type: 'sum', axis: 'y', tip: 'Jumlah akun unik yang melihat postingan' },
        { key: 'impressions', label: 'Impressions', type: 'sum', axis: 'y', tip: 'Total berapa kali postingan ditampilkan' },
        { key: 'likes', label: 'Likes', type: 'sum', axis: 'y', tip: 'Jumlah orang yang Like postingan' },
        { key: 'comments', label: 'Comments', type: 'sum', axis: 'y', tip: 'Jumlah komentar pada postingan' },
        { key: 'engagement', label: 'Eng. Rate %', type: 'avg', axis: 'y1', tip: '(Likes+Comments+Shares+Saves) ÷ Reach × 100%' },
        { key: 'shares', label: 'Shares', type: 'sum', axis: 'y', tip: 'Berapa kali postingan dibagikan ke Story/DM' },
        { key: 'saves', label: 'Saves', type: 'sum', axis: 'y', tip: 'Berapa kali postingan disimpan (bookmark)' },
        { key: 'follows', label: 'Follows', type: 'sum', axis: 'y', tip: 'Jumlah follow baru dari postingan ini' },
        { key: 'profileVisits', label: 'Profile Visits', type: 'sum', axis: 'y', tip: 'Berapa kali profil dikunjungi dari post ini' },
        { key: 'externalLinkTaps', label: 'Link Taps', type: 'sum', axis: 'y', tip: 'Berapa kali link di-tap dari post ini' },
        { key: 'views', label: 'Video Views', type: 'sum', axis: 'y', tip: 'Jumlah views untuk video/reels' }
    ];

    // Init metric pill toggles
    const metricColors = ['#2196F3', '#FF9800', '#4CAF50', '#9C27B0', '#F44336', '#00BCD4', '#E91E63'];

    function initChartControls() {
        const container = document.getElementById('chartMetricsSelector');
        if (!container || container.childElementCount > 0) return;

        chartMetricsConfig.forEach((m, i) => {
            const pill = document.createElement('div');
            pill.className = 'metric-toggle';
            pill.dataset.key = m.key;
            pill.style.setProperty('--metric-color', metricColors[i % metricColors.length]);
            if (m.tip) pill.title = m.tip;

            // Color dot
            const dot = document.createElement('span');
            dot.className = 'toggle-dot';
            pill.appendChild(dot);
            pill.appendChild(document.createTextNode(m.label));

            // Default selection
            if (m.key === 'reach' || m.key === 'engagement') {
                pill.classList.add('active');
            }

            pill.onclick = function () {
                // toggle without a maximum limit
                this.classList.toggle('active');
                try { renderAdvancedChart(); } catch (e) { }
            };

            container.appendChild(pill);
        });

        setChartRange('30'); // Default to last 30 days
    }

    window.setChartRange = function (mode) {
        const d = new Date();
        const end = d.toISOString().split('T')[0];
        let start = '';
        if (mode === '30') {
            d.setDate(d.getDate() - 30);
            start = d.toISOString().split('T')[0];
        } else if (mode === 'all') {
            start = '2020-01-01'; // Arbitrary past
        }
        if (document.getElementById('chartStartDate')) document.getElementById('chartStartDate').value = start;
        if (document.getElementById('chartEndDate')) document.getElementById('chartEndDate').value = end;

        if (window.dataStore) updateProfile(); // Trigger refresh
    };

    function renderAdvancedChart() {
        initChartControls();

        // define glow plugin once (idempotent)
        if (!window._chartGlowPluginRegistered) {
            const glowPlugin = {
                id: 'glowPlugin',
                // apply glow per dataset so color can match dataset borderColor
                beforeDatasetDraw(chart, args, options) {
                    const opt = options || chart.options.plugins.glowPlugin || {};
                    if (!opt.enabled) return;
                    const ctx = chart.ctx;
                    const dsIndex = args.index;
                    const ds = chart.data && chart.data.datasets && chart.data.datasets[dsIndex];
                    if (!ds) return;
                    // compute glow based on chart phase
                    const phase = chart._glowPhase || 0;
                    const factor = 0.5 + 0.5 * Math.sin(phase);
                    // soften overall effect by reducing multiplier and default max
                    const glowMax = (opt.glowMax || 8);
                    const glow = glowMax * factor * 0.6;
                    ctx.save();
                    // prefer dataset borderColor, fallback to plugin color
                    let color = ds.borderColor || opt.color || '#ffb600';
                    // if hex, convert to rgba with softer alpha
                    if (typeof color === 'string' && color[0] === '#') {
                        const r = parseInt(color.slice(1, 3), 16);
                        const g = parseInt(color.slice(3, 5), 16);
                        const b = parseInt(color.slice(5, 7), 16);
                        color = `rgba(${r}, ${g}, ${b}, ${opt.alpha || 0.55})`;
                    } else if (typeof color === 'string' && color.startsWith('rgb(')) {
                        // convert rgb(...) to rgba(..., alpha)
                        color = color.replace(/^rgb\(/, 'rgba(').replace(/\)$/, `, ${opt.alpha || 0.55})`);
                    }
                    ctx.shadowColor = color;
                    ctx.shadowBlur = glow;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                },
                afterDatasetDraw(chart, args) {
                    try { chart.ctx.restore(); } catch (e) { }
                }
            };
            Chart.register(glowPlugin);
            window._chartGlowPluginRegistered = true;
        }

        // Attach change listeners to date inputs once so chart updates when range changes
        try {
            ['chartStartDate', 'chartEndDate'].forEach(id => {
                const el = document.getElementById(id);
                if (el && !el._chartListenerAdded) {
                    el.addEventListener('change', renderAdvancedChart);
                    el.addEventListener('input', renderAdvancedChart);
                    el._chartListenerAdded = true;
                }
            });
            // animate toggle listener
            const animToggle = document.getElementById('chartAnimateToggle');
            if (animToggle && !animToggle._chartListenerAdded) {
                animToggle.addEventListener('change', function () { renderAdvancedChart(); });
                animToggle._chartListenerAdded = true;
            }
        } catch (e) { }

        const canvas = document.getElementById("profileChart");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");

        // 1. Get Date Range
        const startStr = document.getElementById('chartStartDate')?.value || '2000-01-01';
        const endStr = document.getElementById('chartEndDate')?.value || '2099-12-31';

        // 2. Filter Dates
        const allDates = Object.keys(dataStore.posts || {}).sort();
        const filteredDates = allDates.filter(d => d >= startStr && d <= endStr);

        // Update badge showing total posts in selected date range
        try {
            const badge = document.getElementById('chartSelectionBadge');
            const totalPosts = filteredDates.reduce((sum, d) => {
                const p = dataStore.posts[d] || {};
                const items = Array.isArray(p._items) ? p._items : [];
                return sum + items.length;
            }, 0);
            if (badge) badge.innerText = totalPosts + ' post' + (totalPosts === 1 ? '' : 's');
        } catch (e) { }

        if (filteredDates.length === 0) {
            if (window._profileChart) window._profileChart.destroy();
            return;
        }

        // 3. Get Selected Metrics (from pill toggles)
        const selectedKeys = Array.from(document.querySelectorAll('#chartMetricsSelector .metric-toggle.active')).map(el => el.dataset.key);
        if (selectedKeys.length === 0) return; // No metric selected

        // 4. Flatten Data (One Post = One Point)
        // We will build parallel arrays for the Chart.js data
        const chartLabels = []; // X-axis labels (Date)
        const chartMeta = []; // Meta data for click/tooltip (Title, Link, Full Item)

        // Prepare arrays for each selected metric
        const metricData = {};
        selectedKeys.forEach(k => metricData[k] = []);

        filteredDates.forEach(date => {
            const p = dataStore.posts[date];
            const items = Array.isArray(p._items) ? p._items : [];

            items.forEach((item, idx) => {
                // Add label
                chartLabels.push(date);

                // Add Meta
                chartMeta.push({
                    date: date,
                    title: item.title || item.caption || `Post #${idx + 1}`,
                    link: item.link,
                    obj: item
                });

                // Add Values
                selectedKeys.forEach(k => {
                    let val = 0;
                    if (k === 'engagement') {
                        const r = +item.reach || 0;
                        const inter = (item.likes || 0) + (item.comments || 0) + (item.shares || 0) + (item.saves || 0);
                        val = r > 0 ? (inter / r * 100) : 0;
                    } else {
                        val = (+item[k] || 0);
                    }
                    metricData[k].push(val);
                });
            });
        });

        // 5. Build Datasets with Canvas Gradients
        // Helper: hex to rgba
        function hexToRgba(hex, alpha) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        const datasets = selectedKeys.map((k, i) => {
            const conf = chartMetricsConfig.find(m => m.key === k);
            const isY1 = conf.axis === 'y1';
            const color = metricColors[i % metricColors.length];

            // Create gradient fill
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, hexToRgba(color, 0.35));
            gradient.addColorStop(0.7, hexToRgba(color, 0.08));
            gradient.addColorStop(1, hexToRgba(color, 0));

            return {
                label: conf.label,
                data: metricData[k],
                borderColor: color,
                backgroundColor: gradient,
                pointBackgroundColor: '#fff',
                pointBorderColor: color,
                pointBorderWidth: 2,
                pointHoverBackgroundColor: color,
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2,
                fill: true,
                type: 'line',
                borderWidth: 2.5,
                pointRadius: 5,
                pointHoverRadius: 8,
                tension: 0.35,
                yAxisID: isY1 ? 'y1' : 'y'
            };
        });
        // determine whether animations are enabled via UI toggle
        const animateEnabled = !!document.getElementById('chartAnimateToggle')?.checked;
        if (!animateEnabled && window._glowRAF) { try { cancelAnimationFrame(window._glowRAF); } catch (e) { } window._glowRAF = null; }

        const pluginGlowOpts = { enabled: animateEnabled, color: 'rgba(255,182,0,0.95)', glowMax: 8, alpha: 0.55 };
        const animationOpts = animateEnabled ? { duration: 900, easing: 'easeOutQuart' } : { duration: 0 };

        if (window._profileChart) {
            try { window._profileChart.destroy(); } catch (e) { }
            // stop any running glow RAF
            try { if (window._glowRAF) cancelAnimationFrame(window._glowRAF); } catch (e) { }
            window._glowRAF = null;
        }

        // Store meta for interactions
        const metaStore = chartMeta;

        window._profileChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: datasets
            },
            options: {
                animation: animationOpts,
                // finer-grained property transitions
                transitions: {
                    show: {
                        animations: {
                            x: { from: 0, duration: 700, easing: 'easeOutCubic' },
                            y: { from: 0, duration: 700, easing: 'easeOutCubic' }
                        }
                    }
                },
                responsive: true,
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                },
                onClick: (e, elements, chart) => {
                    if (!elements || elements.length === 0) return;
                    const first = elements[0];
                    const idx = first.index;
                    const meta = metaStore[idx];

                    if (meta && meta.link) {
                        const opened = window.open(meta.link, '_blank');
                        if (!opened) alert('Pop-up blocked. Link: ' + meta.link);
                    } else if (meta) {
                        // Fallback show info
                        alert(`Post Details:\nDate: ${meta.date}\nTitle: ${meta.title}\n(No link attached)`);
                    }
                },
                plugins: {
                    title: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(255,255,255,0.95)',
                        titleColor: '#333',
                        bodyColor: '#555',
                        borderColor: '#e0e0e0',
                        borderWidth: 1,
                        titleFont: { size: 13, weight: '600' },
                        bodyFont: { size: 12 },
                        padding: 12,
                        cornerRadius: 8,
                        boxPadding: 4,
                        displayColors: true,
                        usePointStyle: true,
                        callbacks: {
                            title: (items) => {
                                const idx = items[0].dataIndex;
                                const meta = metaStore[idx];
                                return meta.title.length > 50 ? meta.title.substring(0, 50) + '...' : meta.title;
                            },
                            label: (context) => {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    if (label.includes('%') || context.dataset.yAxisID === 'y1') {
                                        label += context.parsed.y.toFixed(2) + '%';
                                    } else {
                                        label += context.parsed.y;
                                    }
                                }
                                return label;
                            },
                            afterTitle: (items) => {
                                const idx = items[0].dataIndex;
                                const meta = metaStore[idx];
                                return meta.date;
                            }
                        }
                    },
                    glowPlugin: pluginGlowOpts,
                    legend: {
                        labels: { usePointStyle: true, boxWidth: 8 }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            maxRotation: 45,
                            minRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 20
                        },
                        grid: { display: false }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Count', font: { size: 11 } },
                        beginAtZero: true,
                        grid: { color: '#f0f0f0' }
                    },
                    y1: {
                        type: 'linear',
                        display: datasets.some(d => d.yAxisID === 'y1'),
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'Rate (%)', font: { size: 11 } },
                        beginAtZero: true
                    }
                }
            }
        });

        // start glow animation loop for this chart if animations enabled
        try {
            if (!animateEnabled) {
                if (window._glowRAF) try { cancelAnimationFrame(window._glowRAF); } catch (e) { }
                window._glowRAF = null;
            } else {
                if (window._glowRAF) try { cancelAnimationFrame(window._glowRAF); } catch (e) { }
                const chart = window._profileChart;
                chart._glowPhase = chart._glowPhase || 0;
                function glowLoop() {
                    // smaller increment -> slower pulsing
                    chart._glowPhase = (chart._glowPhase || 0) + 0.02;
                    if (chart._glowPhase > Math.PI * 2) chart._glowPhase -= Math.PI * 2;
                    try { chart.draw(); } catch (e) { }
                    window._glowRAF = requestAnimationFrame(glowLoop);
                }
                window._glowRAF = requestAnimationFrame(glowLoop);
            }
        } catch (e) { }
    }

    // engagement calculator
    function updateEngagement(prefix = '') {
        const reach = +document.getElementById(prefix + "reach")?.value || 0;
        if (reach <= 0) return document.getElementById(prefix + "engagementRate").innerHTML = "<strong>Engagement Rate:</strong> 0.0%";
        const likes = +document.getElementById(prefix + "likes")?.value || 0;
        const comments = +document.getElementById(prefix + "comments")?.value || 0;
        const shares = +document.getElementById(prefix + "shares")?.value || 0;
        const saves = +document.getElementById(prefix + "saves")?.value || 0;
        const er = ((likes + comments + shares + saves) / reach) * 100;
        const el = document.getElementById(prefix + "engagementRate");

        if (el) el.innerHTML = "<strong>Engagement Rate:</strong> " + er.toFixed(1) + "%";
    }

    let autosaveTimer = null;
    function scheduleAutoSave(ms) {
        try { clearTimeout(autosaveTimer); } catch (e) { }
        // only schedule if autosave enabled in UI
        const enabled = document.getElementById('enableAutoSave')?.checked;
        if (!enabled) return;
        autosaveTimer = setTimeout(function () { if (typeof saveData === 'function') saveData(); }, ms || 1200);
    }

    function updateLastEditedDisplay(iso) {
        // If iso is provided, use it. Otherwise try dataStore.
        const ts = iso || window.dataStore?.lastGlobalEdit;
        const el = document.getElementById("lastEdited");
        if (!el) return;
        if (!ts) { el.textContent = "-"; return; }
        try { el.textContent = new Date(ts).toLocaleString(); } catch (e) { el.textContent = ts; }
    }

    // Helper to update global timestamp and persist
    function updateGlobalLastEdited() {
        if (!window.dataStore) return;
        const now = new Date().toISOString();
        window.dataStore.lastGlobalEdit = now;
        updateLastEditedDisplay(now);
    }

    function importFromExtension(prefix = '') {
        const pasteArea = document.getElementById(prefix ? `${prefix}ExtensionDataPaste` : 'extensionDataPaste');
        const text = pasteArea.value.trim();
        if (!text) {
            alert('Text area kosong. Silakan paste data dari ekstensi.');
            return;
        }

        let fieldsFilledCount = 0;
        let data = {};
        let isJson = false;

        // Try to parse as JSON first
        try {
            data = JSON.parse(text);
            isJson = true;
        } catch (e) {
            isJson = false;
        }

        const mapping = {
            // JSON keys from old extension
            'reach': 'reach',
            'likes': 'likes',
            'comments': 'comments',
            'shares': 'shares',
            'saves': 'saves',
            'impressions': 'impressions',
            'post interactions': 'postInteractions',
            'visit': 'profileVisits',
            'profile visits': 'profileVisits',
            'profilevisits': 'profileVisits', // Added for direct JSON key
            'websiteclicks': 'externalLinkTaps',
            'external link taps': 'externalLinkTaps',
            'externallinktaps': 'externalLinkTaps', // Added for direct JSON key
            'linkclicks': 'externalLinkTaps', // Added for common "linkclicks"
            'plays': 'views', // Assuming plays from old format maps to views

            'postinteractions': 'postInteractions', // <-- Fix for import
            // New ad-specific keys
            'messaging conversations started': 'messagingConversationsStarted',
            // Keys from new extension (and manual paste)
            'views': 'views',
            'accounts reached': 'reach',
            'reels interactions': 'reelsInteractions',
            'profile activity': 'profileActivity',
            'profileactivity': 'profileActivity', // Added for direct JSON key
            'follows': 'follows',
            'business address taps': 'businessAddressTaps',
            'businessaddresstaps': 'businessAddressTaps', // Added for direct JSON key
            'view followers percentage': 'viewFollowersPercentage',
            'view non-followers percentage': 'viewNonFollowersPercentage',
            'interaction followers percentage': 'intFollowersPercentage',
            'interaction non-followers percentage': 'intNonFollowersPercentage',
        };

        if (isJson) {
            for (const key in data) {
                const lowerKey = key.toLowerCase().replace(/\s/g, '');
                const targetField = mapping[lowerKey];
                if (targetField) {
                    let elementId;
                    if (prefix) {
                        // Correctly construct element ID for edit modal
                        elementId = prefix + targetField.charAt(0).toUpperCase() + targetField.slice(1);
                    } else {
                        elementId = targetField;
                    }
                    const element = document.getElementById(elementId);
                    if (element) {
                        element.value = parseFloat(data[key]) || 0;
                        fieldsFilledCount++;
                    }
                }
            }
        } else { // Fallback to line-by-line parsing
            const lines = text.split('\n');
            lines.forEach(line => {
                const parts = line.split(/:(.*)/s);
                if (parts.length < 2) return;

                const key = parts[0].trim().toLowerCase();
                const value = parts[1].trim();

                const targetField = mapping[key];

                if (targetField) {
                    let elementId;
                    if (prefix) {
                        // Correctly construct element ID for edit modal
                        elementId = prefix + targetField.charAt(0).toUpperCase() + targetField.slice(1);
                    } else {
                        elementId = targetField;
                    }
                    const element = document.getElementById(elementId);
                    if (element) {
                        // Clean value (remove dot separators if Indonesian locale style "1.234" -> 1234?)
                        // Assumption: User pastes standard numbers or numbers with dot thousands separator
                        // THIS logic depends on user locale. For now use simple parseFloat or regex.
                        // remove known non-numeric charts
                        let cleanVal = value.replace(/[^0-9.,]/g, '');
                        // simple heuristic: if comma exists and is decimal separator ??
                        // Let's just user parseFloat for now to avoid complexity unless requested
                        element.value = parseFloat(cleanVal) || 0;
                        fieldsFilledCount++;
                    }
                }
            });
        }

        if (fieldsFilledCount > 0) {
            alert('Berhasil mengisi ' + fieldsFilledCount + ' field dari data Import.');
            if (typeof updateEngagement === 'function') updateEngagement(prefix);
            if (typeof updateEditEngagement === 'function') updateEditEngagement();

            // Manual history push for detailed log
            try {
                window.pushHistory(`Imported ${fieldsFilledCount} fields`);
            } catch (e) { }

        } else {
            alert('Tidak ada field yang cocok ditemukan dalam text paste.');
        }

    }
    window.importFromExtension = importFromExtension;

    // save data (now saves into selected item on selected date)
    function saveData() {
        const date = document.getElementById("dateInput")?.value;
        if (!date) { alert("Silakan pilih tanggal terlebih dahulu."); return; }
        if (!window.dataStore.posts[date]) window.dataStore.posts[date] = { _items: [] };
        if (!Array.isArray(window.dataStore.posts[date]._items)) window.dataStore.posts[date]._items = [];

        const idx = window.currentPostIndex || 0;
        if (!window.dataStore.posts[date]._items[idx]) {
            while (window.dataStore.posts[date]._items.length <= idx) {
                window.dataStore.posts[date]._items.push(normalizeItem({ title: 'Post ' + (window.dataStore.posts[date]._items.length + 1) }));
            }
        }

        const item = Object.assign({}, window.dataStore.posts[date]._items[idx]);
        const fieldsToSave = [
            'link', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves',
            'postInteractions', 'reelsInteractions', 'profileActivity', 'messagingConversationsStarted',
            'profileVisits', 'follows', 'externalLinkTaps', 'businessAddressTaps',
            'viewFollowersPercentage', 'viewNonFollowersPercentage',
            'intFollowersPercentage', 'intNonFollowersPercentage'
        ];
        fieldsToSave.forEach(field => {
            const element = document.getElementById(field);
            if (element) {
                item[field] = (element.type === 'number') ? +element.value || 0 : element.value;
            }
        });

        // Perbaikan Bug Caption: Menyimpan caption/notes dengan benar
        const notesVal = document.getElementById("contentNotes")?.value || "";
        item.notes = notesVal;

        // Auto-extract hashtags from notes and merge with existing tags
        const extracted = extractHashtags(notesVal);
        const currentTagInput = document.getElementById("contentTag")?.value || "";
        let currentTags = parseTagsFromString(currentTagInput);

        // Merge and deduplicate
        const mergedTags = [...new Set([...currentTags, ...extracted])];
        const rawTag = mergedTags.join(' ');

        // Update input for visual feedback
        if (document.getElementById("contentTag")) document.getElementById("contentTag").value = rawTag;

        item.tag = rawTag;
        item.tags = parseTagsFromString(rawTag);
        item.lastEdited = new Date().toISOString();
        const titleVal = (document.getElementById("newPostTitle")?.value || "").trim();
        if (titleVal) item.title = titleVal;

        window.dataStore.posts[date]._items[idx] = normalizeItem(item);

        // update profile basic snapshot fields
        dataStore.profile = {
            username: normalizeUsername(document.getElementById("username")?.value || ""),
            followersStart: +document.getElementById("followersStart")?.value || 0,
            followersEnd: +document.getElementById("followersEnd")?.value || 0,
            ageRange: {
                "18-24": +document.getElementById("age18_24")?.value || 0,
                "25-34": +document.getElementById("age25_34")?.value || 0,
                "35-44": +document.getElementById("age35_44")?.value || 0,
                "45-54": +document.getElementById("age45_54")?.value || 0,
                "55-64": +document.getElementById("age55_64")?.value || 0
            },
            gender: { male: +document.getElementById("male")?.value || 0, female: +document.getElementById("female")?.value || 0 }
        };

        normalizePostsStructure();
        generateMonthOptions();
        generateProfileMonthOptions();
        renderTableFiltered();
        renderUsernameAreas();
        renderProfileInputs();
        updateMonthlyReachDisplay();
        updateMonthlyImpressionsDisplay();
        updateStatsUI(); // Panggil pembaruan statistik
        renderTagCloud();
        updateStatsUI(); // Panggil pembaruan statistik
        renderTagCloud();

        updateGlobalLastEdited(); // Persist global timestamp
        // updateLastEditedDisplay(new Date().toISOString()); // Logic moved to helper

        // export option
        if (document.getElementById('exportOnSave')?.checked) exportJson();
        showSaveNotification("Data tersimpan untuk " + date);
        // re-render items list and keep selection
        renderPostItemsForDate(date);
        // mark Load JSON button as loaded (disable animated stroke)
        try { setLoadJsonLoaded(true); } catch (e) { }
        try { renderAdvancedChart(); } catch (e) { }
    }
    window.saveData = saveData;

    // handle date change
    function handleDateChange() {
        const date = document.getElementById("dateInput")?.value;
        if (!date) return;
        // ensure structure exists
        if (!window.dataStore.posts[date]) window.dataStore.posts[date] = { _items: [] };
        if (!Array.isArray(window.dataStore.posts[date]._items)) window.dataStore.posts[date]._items = [];
        // render items & select first if none selected
        if (window.dataStore.posts[date]._items.length === 0) window.currentPostIndex = 0;
        else window.currentPostIndex = Math.min(window.currentPostIndex || 0, window.dataStore.posts[date]._items.length - 1);
        renderPostItemsForDate(date);
        populateFormFromSelected(date, window.currentPostIndex);
        updateEngagement();
    }
    window.handleDateChange = handleDateChange;


    // table rendering & helpers
    function escapeHtml(str) {
        return String(str || "").replace(/[&<>"']/g, function (m) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m];
        });
    }

    function renderTableFiltered() {
        return renderTableFilteredSorted();
    }
    window.renderTableFiltered = renderTableFiltered;

    function renderTableFilteredSorted() {
        const selectedMonth = document.getElementById("monthFilter")?.value || "all";
        const tbody = document.querySelector("#dataTable tbody");
        if (!tbody) return;
        tbody.innerHTML = "";
        const entries = [];
        const dates = Object.keys(dataStore.posts || {});
        dates.forEach(date => {
            const p = dataStore.posts[date] || {};
            const items = Array.isArray(p._items) ? p._items : [];
            items.forEach((v, i) => entries.push({ date, idx: i, data: v, token: `${date}||${i}` }));
        });

        // filter month
        let filtered = entries.filter(e => {
            if (selectedMonth !== "all" && !e.date.startsWith(selectedMonth)) return false;
            return true;
        });

        // selectedTags filter: if selectedTags set, only include entries that contain at least one selected tag
        const selectedKwSet = new Set((document.getElementById('tagFilter')?.value || '').toLowerCase().split(/\s+/).filter(Boolean));
        if (window.selectedTags && window.selectedTags.size) {
            // if user used tag cloud to select tags, ensure keyword sync
            Array.from(window.selectedTags).forEach(t => selectedKwSet.add(t));
        }

        if (selectedKwSet.size) {
            filtered = filtered.filter(e => {
                const txtFields = ((e.data.title || "") + " " + (e.data.link || "") + " " + (e.data.notes || "") + " " + ((Array.isArray(e.data.tags) ? e.data.tags.join(' ') : (e.data.tag || ""))) + " " + e.date).toLowerCase();
                // must contain all words in selectedKwSet (improves responsiveness)
                for (const w of selectedKwSet) {
                    if (!txtFields.includes(w)) return false;
                }
                return true;
            });
        }

        // sorting
        const sortField = document.getElementById('sortField')?.value || 'date';
        const sortDir = document.getElementById('sortDir')?.value || 'none';

        // Precompute score and ranks (used for rank badges and sort by rank)
        const rankMap = new Map();
        try {
            // New weighted Score formula per user request:
            // Score = (Reach × 1/2) + (Impressions × 1/2) + (Likes × 1) + (Comments × 3) + (Shares × 4) + (Saves × 4)
            const calcScore = d => {
                const reach = +(d?.reach || 0);
                const impressions = +(d?.impressions || 0);
                const likes = +(d?.likes || 0);
                const comments = +(d?.comments || 0);
                const shares = +(d?.shares || 0);
                const saves = +(d?.saves || 0);
                return (reach * 0.5) + (impressions * 0.5) + (likes * 1) + (comments * 3) + (shares * 4) + (saves * 4);
            };
            const scored = filtered.map(e => ({ token: e.token, score: calcScore(e.data) }));
            scored.sort((a, b) => b.score - a.score);
            scored.forEach((s, idx) => { rankMap.set(s.token, idx + 1); });
        } catch (e) {
            // non-fatal
        }
        if (sortDir && sortDir !== 'none') {
            filtered.sort((a, b) => {
                let va, vb;
                if (sortField === 'date') { va = a.date; vb = b.date; }
                else if (sortField === 'rank') {
                    // lower rank number is better (1 is top)
                    va = rankMap.get(a.token) || 999999; vb = rankMap.get(b.token) || 999999;
                    if (sortDir === 'highest') return va - vb; // show top ranks first
                    if (sortDir === 'lowest') return vb - va;
                    return 0;
                }
                else if (sortField === 'engagement') {
                    const calc = d => (d && d.engagement !== undefined) ? +d.engagement : ((d && d.reach) ? (((d.likes || 0) + (d.comments || 0) + (d.shares || 0) + (d.saves || 0)) / (d.reach || 1) * 100) : 0);
                    va = calc(a.data); vb = calc(b.data);
                } else {
                    va = +(a.data?.[sortField] || 0);
                    vb = +(b.data?.[sortField] || 0);
                }
                if (sortDir === 'highest') return vb - va;
                if (sortDir === 'lowest') return va - vb;
                return 0;
            });
        } else {
            filtered.sort((a, b) => b.date.localeCompare(a.date));
        }
        

        // Build sort badge labels map
        const sortLabelMap = {
            reach: 'Reach', impressions: 'Impr', likes: 'Likes', comments: 'Comments',
            shares: 'Shares', saves: 'Saves', follows: 'Follows',
            profileVisits: 'Profile Visits', externalLinkTaps: 'Link Taps', views: 'Views',
            engagement: 'Eng. Rate'
        };

        // render rows
        filtered.forEach(entry => {
            const date = entry.date;
            const d = entry.data || {};
            const rate = (d && d.engagement !== undefined) ? d.engagement : (d.reach > 0 ? (((d.likes || 0) + (d.comments || 0) + (d.shares || 0) + (d.saves || 0)) / (d.reach || 1) * 100) : 0);
            const tags = Array.isArray(d.tags) ? d.tags : (d.tag ? parseTagsFromString(d.tag) : []);
            const tagHtml = tags.map(t => `<span class="badge" onclick="selectTagFromTable('${escapeHtml(t)}')">#${escapeHtml(t)}</span>`).join(' ');
            const linkHtml = d.link ? `<a href="${escapeHtml(d.link)}" target="_blank">${escapeHtml(d.link)}</a>` : "";
            const titleHtml = d.title ? `<div class="metaSmall">(${escapeHtml(d.title)})</div>` : "";
            const notesHtml = d.notes ? `<div class="metaSmall">Notes: ${escapeHtml(d.notes)}</div>` : "";

            // Badge for sorted metric (only when sorting by a non-date metric)
            let sortBadgeHtml = '';
            // Rank badges for all ranks: #1..n; top 3 get blue, others grey. Hover shows calculation info.
            let rankBadgeHtml = '';
            let rankStarHtml = '';
            try {
                const rank = rankMap.get(entry.token);
                if (rank) {
                    const tooltip = "Peringkat dihitung dari Score = (Reach × 1/2) + (Impressions × 1/2) + (Likes × 1) + (Comments × 3) + (Shares × 4) + (Saves × 4).";
                    const cls = (rank <= 3) ? 'top' : 'other';
                    rankBadgeHtml = `<span class="rank-badge ${cls}" title="${tooltip}">#${rank}</span>`;
                    if (rank === 1) {
                        rankStarHtml = `<span class="top-rank-star" title="${tooltip}">★</span>`;
                    }
                }
            } catch (e) { }
            if (sortField !== 'date' && sortDir !== 'none' && sortLabelMap[sortField]) {
                let badgeVal;
                if (sortField === 'engagement') {
                    badgeVal = Number(rate).toFixed(1) + '%';
                } else {
                    badgeVal = (+(d[sortField] || 0)).toLocaleString();
                }
                sortBadgeHtml = `<span style="display:inline-block;background:#e3f2fd;color:#1565c0;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-right:6px;vertical-align:middle;">${sortLabelMap[sortField]}: ${badgeVal}</span>`;
            }

            const meta = (tagHtml || titleHtml || notesHtml) ? `<div style="margin-top:6px; text-align:left;">${tagHtml}${titleHtml}${notesHtml}</div>` : "";
            const row = `<tr>
        <td>${escapeHtml(date)}</td>
        <td style="text-align:left;">${rankStarHtml}${rankBadgeHtml}${sortBadgeHtml}${linkHtml}${meta}</td>
        <td>${d.reach || 0}</td>
        <td>${d.impressions || 0}</td>
        <td>${d.likes || 0}</td>
        <td>${d.comments || 0}</td>
        <!-- Saves and visits removed -->
        <td>${Number(rate).toFixed(1)}%</td>
        <td><button class="btn-secondary" onclick="editData('${entry.token}')">Ubah</button> <button class="btn-danger" onclick="deleteData('${entry.token}')">Hapus</button></td>
      </tr>`;
            tbody.insertAdjacentHTML("beforeend", row);
        });

        try { applyCompactSetting(); } catch (e) { }
        renderTagCloud();
        // update visuals of tag cloud to reflect current tagFilter tokens
        syncSelectedTagsFromFilter();
    }
    window.renderTableFilteredSorted = renderTableFilteredSorted;

    function syncSelectedTagsFromFilter() {
        const tfVal = (document.getElementById('tagFilter')?.value || '').trim().toLowerCase();
        if (!tfVal) {
            window.selectedTags = new Set();
        } else {
            // parse words and set as selected tags set
            const arr = tfVal.split(/\s+/).filter(Boolean);
            window.selectedTags = new Set(arr);
        }
        // update cloud visuals
        document.querySelectorAll('#tagCloud .badge').forEach(b => {
            const t = b.getAttribute('data-tag');
            b.classList.toggle('active', window.selectedTags.has(t));
        });
    }

    // compact settings
    function applyCompactSetting() {
        const compact = document.getElementById('compactToggle')?.checked;
        const limitRaw = document.getElementById('compactLimit')?.value;
        const limit = Math.max(1, parseInt(limitRaw || '10', 10) || 10);
        const tbody = document.querySelector('#dataTable tbody');
        if (!tbody) return;
        Array.from(tbody.querySelectorAll('tr')).forEach((r, i) => r.style.display = (compact && i >= limit) ? 'none' : '');
    }
    function initCompactObserver() {
        const tbody = document.querySelector('#dataTable tbody');
        if (!tbody) return;
        applyCompactSetting();
        const obs = new MutationObserver(() => applyCompactSetting());
        obs.observe(tbody, { childList: true });
        document.getElementById('compactToggle')?.addEventListener('change', applyCompactSetting);
        document.getElementById('compactLimit')?.addEventListener('input', applyCompactSetting);
    }

    function toggleTable() {
        const el = document.getElementById('postSection');
        if (!el) return;
        el.style.display = (el.style.display === 'none') ? '' : 'none';
    }
    window.toggleTable = toggleTable;

    function resetTagCloud() {
        const tf = document.getElementById('tagFilter');
        if (tf) tf.value = '';
        window.selectedTags = new Set();
        document.querySelectorAll('#tagCloud .badge').forEach(b => b.classList.remove('active'));
        renderTableFiltered();
        renderTagCloud();
    }
    window.resetTagCloud = resetTagCloud;

    // edit/delete functions (tokens are date||idx)
    function editData(token) {
        const parts = String(token || '').split('||');
        const originalDate = parts[0];
        const idx = parseInt(parts[1], 10);
        if (!originalDate || !dataStore.posts[originalDate] || !dataStore.posts[originalDate]._items[idx]) {
            return alert("Data tidak ditemukan untuk " + token);
        }
        const data = dataStore.posts[originalDate]._items[idx];

        document.getElementById('editToken').value = token;
        document.getElementById('editDate').value = originalDate;

        // Daftar field yang akan diisi di modal edit
        const fields = [ // Ramped up fields array
            'Title', 'Link', 'Reach', 'Impressions', 'PostInteractions', 'Likes', 'Comments', 'Shares', 'Saves',
            'ReelsInteractions', 'ProfileActivity', 'ProfileVisits', 'Follows', 'ExternalLinkTaps', 'BusinessAddressTaps', 'MessagingConversationsStarted',
            'ViewFollowersPercentage', 'ViewNonFollowersPercentage',
            'IntFollowersPercentage', 'IntNonFollowersPercentage'
        ];

        fields.forEach(field => {
            const element = document.getElementById('edit' + field);
            if (element) {
                const key = field.charAt(0).toLowerCase() + field.slice(1);
                element.value = data[key] || (element.type === 'number' ? 0 : '');
            }
        });

        // Penanganan khusus untuk Tag dan Notes (Caption) untuk memastikan kompatibilitas
        document.getElementById('editContentTag').value = (data.tags || []).join(', ') || data.tag || '';
        // Perbaikan Bug Caption: Memuat 'notes' atau 'contentNotes' dari data lama/baru
        document.getElementById('editContentNotes').value = data.notes || data.contentNotes || '';

        document.getElementById('editModal').style.display = 'flex';
        calculateModalEngagementRate(); // Panggil kalkulasi engagement yang benar saat modal dibuka

    }
    window.editData = editData;

    // Fungsi untuk menghitung engagement rate di dalam modal edit
    function updateEditEngagement() {
        updateEngagement('edit');
    }
    window.updateEditEngagement = updateEditEngagement;

    // Fungsi kalkulasi engagement yang didedikasikan KHUSUS untuk modal edit
    function calculateModalEngagementRate() {
        const reach = +document.getElementById('editReach')?.value || 0;
        const likes = +document.getElementById('editLikes')?.value || 0;
        const comments = +document.getElementById('editComments')?.value || 0;
        const shares = +document.getElementById('editShares')?.value || 0;
        const saves = +document.getElementById('editSaves')?.value || 0;
        const el = document.getElementById('editEngagementRate');
        if (!el) return;

        const er = reach > 0 ? ((likes + comments + shares + saves) / reach) * 100 : 0;
        el.innerHTML = "<strong>Engagement Rate:</strong> " + er.toFixed(1) + "%";
    }

    function deleteData(token) {
        const parts = String(token || '').split('||');
        const date = parts[0];
        const idx = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        if (!date || !dataStore.posts[date]) return alert("Data tidak ditemukan untuk " + token);
        if (!confirm("Hapus data untuk " + token + "?")) return;
        if (Array.isArray(dataStore.posts[date]._items) && dataStore.posts[date]._items[idx]) {
            dataStore.posts[date]._items.splice(idx, 1);
            if (!dataStore.posts[date]._items.length) delete dataStore.posts[date];
        }
        updateGlobalLastEdited(); // Update timestamp on delete
        generateMonthOptions();
        renderTableFiltered();
        updateMonthlyReachDisplay();
        updateMonthlyImpressionsDisplay();
        updateStatsUI(); // Panggil pembaruan statistik
        renderTagCloud();
        // Update post items list if current date matches
        if (document.getElementById('dateInput')?.value === date) renderPostItemsForDate(date);

        try { window.pushHistory(`Deleted Post ${date}`); } catch (e) { }
    }
    window.deleteData = deleteData;

    // Fungsi baru untuk menambahkan item post dengan data yang sudah ada
    function addPostItemWithData(date, data) {
        if (!date) {
            alert("Tanggal baru tidak valid untuk menyimpan data.");
            return;
        }
        if (!window.dataStore.posts[date]) {
            window.dataStore.posts[date] = { _items: [] };
        }
        if (!Array.isArray(window.dataStore.posts[date]._items)) {
            window.dataStore.posts[date]._items = [];
        }
        window.dataStore.posts[date]._items.push(normalizeItem(data));
    }

    function closeEditModal() {
        document.getElementById('editModal').style.display = 'none';
    }
    window.closeEditModal = closeEditModal;

    function saveEditData() {
        const token = document.getElementById('editToken').value;
        const parts = token.split('||');
        const originalDate = parts[0];
        const idx = parseInt(parts[1], 10);

        if (!originalDate || !dataStore.posts[originalDate] || dataStore.posts[originalDate]._items[idx] === undefined) {
            alert('Error: Data asli tidak ditemukan untuk disimpan.');
            return;
        }

        const newDate = document.getElementById('editDate').value;

        const editedData = {};
        const fieldsToSave = [
            'Title', 'Link', 'Reach', 'Impressions', 'PostInteractions', 'Likes', 'Comments', 'Shares', 'Saves',
            'ReelsInteractions', 'ProfileActivity', 'ProfileVisits', 'Follows', 'ExternalLinkTaps', 'BusinessAddressTaps', 'MessagingConversationsStarted',
            'ViewFollowersPercentage', 'ViewNonFollowersPercentage',
            'IntFollowersPercentage', 'IntNonFollowersPercentage'
        ];

        fieldsToSave.forEach(field => {
            const element = document.getElementById('edit' + field);
            if (element) {
                const key = field.charAt(0).toLowerCase() + field.slice(1);
                editedData[key] = (element.type === 'number') ? +element.value || 0 : element.value;
            }
        });

        // Perbaikan Bug Caption: Menyimpan notes/caption dari modal edit dengan benar
        const notesVal = document.getElementById('editContentNotes').value || "";
        editedData.notes = notesVal;

        // Auto-extract hashtags from notes (edit modal)
        const extracted = extractHashtags(notesVal);
        const currentTagInput = document.getElementById('editContentTag').value || "";
        let currentTags = parseTagsFromString(currentTagInput);

        // Merge and deduplicate
        const mergedTags = [...new Set([...currentTags, ...extracted])];
        const rawTag = mergedTags.join(' ');

        // Update input for visual feedback
        if (document.getElementById('editContentTag')) document.getElementById('editContentTag').value = rawTag;

        editedData.tag = rawTag;
        editedData.tags = parseTagsFromString(rawTag);
        editedData.lastEdited = new Date().toISOString();

        const reach = editedData.reach;
        const likes = editedData.likes;
        const comments = editedData.comments;
        const shares = editedData.shares;
        const saves = editedData.saves;
        editedData.engagement = reach > 0 ? ((likes + comments + shares + saves) / reach) * 100 : 0;

        // Hapus data lama dan tambahkan data baru (menangani perubahan tanggal)
        const oldData = dataStore.posts[originalDate]._items[idx];

        // Calculate DIFFS for history log
        let diffs = [];
        if (originalDate !== newDate) diffs.push(`Date: ${originalDate}->${newDate}`);
        const importantFields = ['reach', 'impressions', 'likes', 'comments', 'shares', 'saves'];
        importantFields.forEach(f => {
            const oldVal = parseFloat(oldData[f] || 0);
            const newVal = parseFloat(editedData[f] || 0);
            if (oldVal !== newVal) diffs.push(`${f.charAt(0).toUpperCase() + f.slice(1)}`);
        });
        const commentsDiff = (oldData.notes || '') !== (editedData.notes || '') ? 'Notes' : '';
        if (commentsDiff) diffs.push(commentsDiff);

        const diffStr = diffs.length ? diffs.slice(0, 3).join(', ') + (diffs.length > 3 ? '...' : '') : 'Metadata';

        deletePostItem(originalDate, idx);
        addPostItemWithData(newDate, editedData);

        // Simpan ke localStorage dan perbarui UI
        localStorage.setItem('instagram_insight_data', JSON.stringify(window.dataStore));
        renderTableFiltered();
        renderTagCloud();
        generateMonthOptions();
        updateStatsUI(); // Panggil pembaruan statistik
        closeEditModal();
        showSaveNotification('Data berhasil diperbarui!');
        updateGlobalLastEdited(); // Update timestamp on edit save

        try { window.pushHistory(`Edit: ${diffStr}`); } catch (e) { }
        // mark Load JSON as loaded (disable animated stroke) when edits are saved
        try { setLoadJsonLoaded(true); } catch (e) { }
        try { renderAdvancedChart(); } catch (e) { }
    }
    window.saveEditData = saveEditData;

    // export/import
    function exportJson() {
        // export current dataStore as-is (uses _items structure)
        const blob = new Blob([JSON.stringify(dataStore, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "insight_data.json"; a.click();
    }
    window.exportJson = exportJson;

    function loadJson(event) {
        const file = event?.target?.files && event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const parsed = JSON.parse(e.target.result);
                if (parsed.profile) dataStore.profile = Object.assign({}, dataStore.profile || {}, parsed.profile);
                if (parsed.profileSnapshots) dataStore.profileSnapshots = Object.assign({}, dataStore.profileSnapshots || {}, parsed.profileSnapshots);
                if (parsed.posts) {
                    // merge posts, normalize numbers, accept both legacy and new formats
                    Object.keys(parsed.posts).forEach(d => {
                        const p = parsed.posts[d] || {};
                        // If parsed has _items already use them
                        if (Array.isArray(p._items)) {
                            p._items = p._items.map(v => normalizeItem(v));
                            dataStore.posts[d] = { _items: p._items };
                        } else {
                            // legacy: main object + optional _variants
                            const items = [];
                            const main = Object.assign({}, p);
                            const variants = Array.isArray(main._variants) ? main._variants : [];
                            if (main._variants) delete main._variants;
                            items.push(normalizeItem(main));
                            (variants || []).forEach(v => items.push(normalizeItem(v)));
                            dataStore.posts[d] = { _items: items };
                        }
                    });
                }
                // normalize fully to ensure new structure
                normalizePostsStructure();
                generateMonthOptions();
                generateProfileMonthOptions();
                renderTableFiltered();
                renderProfileInputs();
                renderUsernameAreas();
                updateMonthlyReachDisplay();
                updateMonthlyImpressionsDisplay();
                updateStatsUI(); // Panggil pembaruan statistik
                renderTagCloud();
                updateStatsUI(); // Panggil pembaruan statistik
                renderTagCloud();

                // Restore lastGlobalEdit if present (Backward Compatibility: if missing, keep existing or set current? Let's respect file if exists)
                if (parsed.lastGlobalEdit) {
                    dataStore.lastGlobalEdit = parsed.lastGlobalEdit;
                }
                updateLastEditedDisplay();

                // turn footer Load JSON button grey and disable animated stroke
                try {
                    const loadBtn = document.getElementById('loadJsonFooterBtn') || document.querySelector('label[for="jsonFileFooter"]');
                    if (loadBtn) {
                        loadBtn.classList.remove('stroke-loop', 'pulse-attention');
                        loadBtn.classList.add('loaded');
                    }
                } catch (e) { /* ignore */ }

                try { renderAdvancedChart(); } catch (e) { }

                alert("Data JSON berhasil dimuat! (" + Object.keys(dataStore.posts || {}).length + " tanggal, " + Object.keys(dataStore.profileSnapshots || {}).length + " snapshot)");
            } catch (err) {
                console.error('loadJson error', err);
                alert("File JSON tidak valid atau terjadi kesalahan parsing: " + (err && err.message ? err.message : 'unknown error'));
            }
        };
        reader.readAsText(file);
    }
    window.loadJson = loadJson;

    // Utility: mark footer Load JSON label as loaded (grey + disable stroke)
    function setLoadJsonLoaded(state) {
        try {
            const el = document.getElementById('loadJsonFooterBtn') || document.querySelector('label[for="jsonFileFooter"]');
            if (!el) return;
            if (state) {
                el.classList.remove('stroke-loop', 'pulse-attention');
                el.classList.add('loaded');
            } else {
                el.classList.remove('loaded');
                // re-enable stroke-loop if desired
                el.classList.add('stroke-loop');
            }
        } catch (e) { }
    }
    window.setLoadJsonLoaded = setLoadJsonLoaded;

    // CSV exports
    function exportCsvPostsMode(mode) {
        const selectedMonth = document.getElementById("monthFilter")?.value || "all";
        const rows = [["Date", "Link", "Reach", "Impressions", "Likes", "Comments", "Shares", "Saves", "Post Interactions", "Profile Visits", "Engagement Rate", "Tags"]];
        Object.keys(dataStore.posts || {}).sort().forEach(date => {
            if (mode === "filter" && selectedMonth !== "all" && !date.startsWith(selectedMonth)) return;
            const p = dataStore.posts[date] || {};
            const items = Array.isArray(p._items) ? p._items : [];
            items.forEach(it => {
                const d = it || {};
                const rate = d.engagement !== undefined ? d.engagement : (d.reach > 0 ? (((d.likes || 0) + (d.comments || 0) + (d.shares || 0) + (d.saves || 0)) / (d.reach || 1) * 100) : 0);
                rows.push([date, d.link || "", d.reach || 0, d.impressions || 0, d.likes || 0, d.comments || 0, d.shares || 0, d.saves || 0, d.postInteractions || 0, d.profileVisits || 0, Number(rate).toFixed(1) + "%", (d.tags || []).join(' ')]);
            });
        });
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = mode === "filter" ? "posts_filtered.csv" : "posts_all.csv"; a.click();
    }
    window.exportCsvPosts = function () { exportCsvPostsMode("all"); };
    window.exportCsvPostsFiltered = function () { exportCsvPostsMode("filter"); };


    function exportCsvProfile() {
        const p = dataStore.profile || {};
        const rows = [
            ["Username", "Profile URL", "Followers Start", "Followers End", "Male %", "Female %", "18-24", "25-34", "35-44", "45-54", "55-64"],
            [p.username ? ("@" + normalizeUsername(p.username)) : "", buildProfileURL(p.username || ""), p.followersStart || 0, p.followersEnd || 0, p.gender?.male || 0, p.gender?.female || 0, p.ageRange?.["18-24"] || 0, p.ageRange?.["25-34"] || 0, p.ageRange?.["35-44"] || 0, p.ageRange?.["45-54"] || 0, p.ageRange?.["55-64"] || 0]
        ];
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "profile_data.csv"; a.click();
    }
    window.exportCsvProfile = exportCsvProfile;

    // Excel Export using SheetJS
    function exportToExcel() {
        if (typeof XLSX === 'undefined') {
            alert("Library SheetJS belum dimuat. Periksa koneksi internet.");
            return;
        }

        // 1. Prepare Posts Data
        const postsData = [];
        Object.keys(dataStore.posts || {}).sort().reverse().forEach(date => {
            const p = dataStore.posts[date] || {};
            const items = Array.isArray(p._items) ? p._items : [];
            items.forEach(d => {
                const rate = d.engagement !== undefined ? d.engagement : (d.reach > 0 ? (((d.likes || 0) + (d.comments || 0) + (d.shares || 0) + (d.saves || 0)) / (d.reach || 1) * 100) : 0);
                postsData.push({
                    "Date": date,
                    "Title": d.title || "",
                    "Link": d.link || "",
                    "Caption/Notes": d.notes || "",
                    "Tags": (d.tags || []).join(', '),
                    "Reach": d.reach || 0,
                    "Impressions": d.impressions || 0,
                    "Likes": d.likes || 0,
                    "Comments": d.comments || 0,
                    "Shares": d.shares || 0,
                    "Saves": d.saves || 0,
                    "Engagement Rate %": Number(Number(rate).toFixed(2)),
                    "Post Interactions": d.postInteractions || 0,
                    "Profile Visits": d.profileVisits || 0,
                    "Profile Activity": d.profileActivity || 0,
                    "Follows": d.follows || 0,
                    "Link Taps": d.externalLinkTaps || 0,
                    "Addr Taps": d.businessAddressTaps || 0,
                    "Msgs Started": d.messagingConversationsStarted || 0,
                    "Views": d.views || 0
                });
            });
        });

        // 2. Prepare Profile Data
        const p = dataStore.profile || {};
        const profileData = [{
            "Username": p.username || "",
            "Followers Start": p.followersStart || 0,
            "Followers End": p.followersEnd || 0,
            "Values": "Start/End"
        }, {
            "Username": "Growth",
            "Followers Start": (p.followersEnd || 0) - (p.followersStart || 0),
            "Followers End": "",
            "Values": "Diff"
        }];

        // 3. Create Workbook
        const wb = XLSX.utils.book_new();

        // Add Posts Sheet
        const wsPosts = XLSX.utils.json_to_sheet(postsData);
        // Auto-width for some columns
        const wscols = [
            { wch: 12 }, // Date
            { wch: 20 }, // Title
            { wch: 30 }, // Link
            { wch: 40 }, // Caption
            { wch: 20 }, // Tags
        ];
        wsPosts['!cols'] = wscols;
        XLSX.utils.book_append_sheet(wb, wsPosts, "Post Insights");

        // Add Profile Sheet
        const wsProfile = XLSX.utils.json_to_sheet(profileData);
        XLSX.utils.book_append_sheet(wb, wsProfile, "Profile Stats");

        // 4. Download
        XLSX.writeFile(wb, "Instagram_Insight_Report.xlsx");
    }
    window.exportToExcel = exportToExcel;

    // snapshots
    function saveProfileSnapshot() {
        const month = document.getElementById("profileMonthInput")?.value;
        if (!month) return alert("Silakan pilih bulan (YYYY-MM) untuk menyimpan snapshot.");
        const snap = {
            username: normalizeUsername(document.getElementById("username")?.value || ""),
            followersStart: +document.getElementById("followersStart")?.value || 0,
            followersEnd: +document.getElementById("followersEnd")?.value || 0,
            ageRange: {
                "18-24": +document.getElementById("age18_24")?.value || 0,
                "25-34": +document.getElementById("age25_34")?.value || 0,
                "35-44": +document.getElementById("age35_44")?.value || 0,
                "45-54": +document.getElementById("age45_54")?.value || 0,
                "55-64": +document.getElementById("age55_64")?.value || 0
            },
            gender: { male: +document.getElementById("male")?.value || 0, female: +document.getElementById("female")?.value || 0 }
        };
        dataStore.profileSnapshots[month] = snap;
        generateProfileMonthOptions();
        alert("Snapshot profile tersimpan untuk " + month);
        try { setLoadJsonLoaded(true); } catch (e) { }
        try { renderAdvancedChart(); } catch (e) { }
    }
    window.saveProfileSnapshot = saveProfileSnapshot;


    function loadProfileSnapshot() {
        const selected = document.getElementById("profileMonthFilter")?.value;
        if (!selected || selected === "all") { renderProfileInputs(); updateProfile(); updateMonthlyReachDisplay(); updateMonthlyImpressionsDisplay(); return; }
        document.getElementById("profileMonthInput").value = selected;
        const snap = dataStore.profileSnapshots[selected];
        if (!snap) { renderProfileInputs(); updateProfile(); updateMonthlyReachDisplay(); updateMonthlyImpressionsDisplay(); return; }
        document.getElementById("username").value = snap.username || "";
        // Determine previous snapshot (if any) and set followersStart to previous followersEnd (read-only)
        const months = Object.keys(dataStore.profileSnapshots || {}).sort();
        const idx = months.indexOf(selected);
        const fsEl = document.getElementById("followersStart");
        const feEl = document.getElementById("followersEnd");
        if (idx > 0) {
            const prev = dataStore.profileSnapshots[months[idx - 1]] || {};
            const prevFollowers = (prev.followersEnd || prev.followersStart || 0);
            if (fsEl) { fsEl.value = prevFollowers; fsEl.disabled = true; }
        } else {
            // first snapshot: allow editing if no legacy 'mulai' exists
            if (fsEl) { fsEl.value = (snap.followersStart || dataStore.profile?.followersStart || 0); fsEl.disabled = false; }
        }
        if (feEl) { feEl.value = snap.followersEnd || 0; feEl.disabled = false; }
        document.getElementById("age18_24").value = snap.ageRange?.["18-24"] || 0;
        document.getElementById("age25_34").value = snap.ageRange?.["25-34"] || 0;
        document.getElementById("age35_44").value = snap.ageRange?.["35-44"] || 0;
        document.getElementById("age45_54").value = snap.ageRange?.["45-54"] || 0;
        document.getElementById("age55_64").value = snap.ageRange?.["55-64"] || 0;
        document.getElementById("male").value = snap.gender?.male || 0;
        document.getElementById("female").value = snap.gender?.female || 0;
        renderUsernamePreview();
        updateProfile();
    }
    window.loadProfileSnapshot = loadProfileSnapshot;

    function deleteProfileSnapshot() {
        const selected = document.getElementById("profileMonthFilter")?.value;
        if (!selected || selected === "all") return alert("Pilih snapshot bulan terlebih dahulu.");
        if (!confirm("Hapus snapshot untuk " + selected + " ?")) return;
        delete dataStore.profileSnapshots[selected];
        generateProfileMonthOptions();
        renderProfileInputs();
        updateProfile();
    }
    window.deleteProfileSnapshot = deleteProfileSnapshot;

    // UI init
    function showSaveNotification(msg) {
        try {
            const id = 'save-notif';
            let n = document.getElementById(id);
            if (!n) {
                n = document.createElement('div'); n.id = id;
                n.style.position = 'fixed'; n.style.right = '16px'; n.style.top = '16px';
                n.style.background = '#111'; n.style.color = '#fff'; n.style.padding = '10px 14px';
                n.style.borderRadius = '8px'; n.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
                n.style.zIndex = 9999; n.style.fontSize = '13px'; n.style.transition = 'opacity 400ms'; n.style.opacity = '0';
                document.body.appendChild(n);
            }
            n.textContent = msg || 'Tersimpan';
            n.style.opacity = '1';
            if (n._hideTimeout) clearTimeout(n._hideTimeout);
            n._hideTimeout = setTimeout(() => { n.style.opacity = '0'; }, 1700);
        } catch (e) { }
    }
    window.showSaveNotification = showSaveNotification;

    // wire events on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function () {
        // inputs
        document.getElementById('dateInput')?.addEventListener('change', handleDateChange);
        const fieldsToWatch = [
            'link', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves',
            'postInteractions', 'reelsInteractions', 'views', 'profileActivity',
            'profileVisits', 'follows', 'externalLinkTaps', 'businessAddressTaps',
            'viewFollowersPercentage', 'viewNonFollowersPercentage',
            'intFollowersPercentage', 'intNonFollowersPercentage', 'contentNotes', 'contentTag', 'newPostTitle'
        ];
        fieldsToWatch.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', function () { updateEngagement(); scheduleAutoSave(1200); });
        });
        document.getElementById('username')?.addEventListener('input', renderUsernamePreview);
        document.getElementById('profileMonthFilter')?.addEventListener('change', loadProfileSnapshot);
        document.getElementById('monthFilter')?.addEventListener('change', renderTableFiltered);
        document.getElementById('sortField')?.addEventListener('change', function () { renderTableFiltered(); });
        document.getElementById('sortDir')?.addEventListener('change', function () { renderTableFiltered(); });
        document.getElementById('tagFilter')?.addEventListener('input', function () {
            // sync selectedTags visually and do immediate rendering
            syncSelectedTagsFromFilter();
            renderTableFiltered();
        });
        document.getElementById('applyTableFilterBtn')?.addEventListener('click', function () { renderTableFiltered(); });

        document.getElementById('jsonFile')?.addEventListener('change', loadJson);

        // Tambahkan event listener untuk input di modal edit
        const editFieldsToWatch = [
            'editReach', 'editLikes', 'editComments', 'editShares', 'editSaves'
        ];
        editFieldsToWatch.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', calculateModalEngagementRate);
        });

        initCompactObserver();

        // initialize UI from dataStore
        normalizePostsStructure();
        renderProfileInputs();
        renderUsernameAreas();
        generateMonthOptions();
        generateProfileMonthOptions();
        renderTableFiltered();
        updateMonthlyReachDisplay();
        updateMonthlyImpressionsDisplay();
        // updateStatsUI(); // Called below in combined init
        renderTagCloud();

        // Init last edited display from localStorage if available
        updateLastEditedDisplay();
    });

    // expose some functions globally
    window.renderPostVariantsForDate = renderPostVariantsForDate;
    window.getVariantsForDate = getVariantsForDate;
    window.buildProfileURL = buildProfileURL;
    window.buildProfileText = buildProfileText;
    window.renderProfileInputs = renderProfileInputs;
    window.renderUsernameAreas = renderUsernameAreas;
    window.renderTagCloud = renderTagCloud;
    window.generateMonthOptions = generateMonthOptions;
    window.generateProfileMonthOptions = generateProfileMonthOptions;
    window.updateMonthlyReachDisplay = updateMonthlyReachDisplay;
    window.updateMonthlyImpressionsDisplay = updateMonthlyImpressionsDisplay;
    window.updateEngagement = updateEngagement;
    window.scheduleAutoSave = scheduleAutoSave;
    window.applyCompactSetting = applyCompactSetting;
    window.renderTableFilteredSorted = renderTableFilteredSorted;
    window.saveData = saveData;
    window.loadJson = loadJson;
    window.editData = editData;
    window.deleteData = deleteData;
    window.saveProfileSnapshot = saveProfileSnapshot;
    window.loadProfileSnapshot = loadProfileSnapshot;
    window.deleteProfileSnapshot = deleteProfileSnapshot;
    window.exportJson = exportJson;
    window.selectTagFromTable = selectTagFromTable;
    // expose updateProfile so inline onclick="updateProfile()" works
    window.updateProfile = updateProfile;

})();

(function () {
    // --- Helpers to compute totals from a given snapshot object ---
    function computeTotalsOnSnapshot(snapshot, month) {
        month = month || 'all';
        const out = { posts: 0, reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0, websiteClicks: 0 };
        try {
            const postsObj = snapshot && snapshot.posts ? snapshot.posts : {};
            Object.keys(postsObj).forEach(d => {
                if (!d) return;
                if (month !== 'all' && !d.startsWith(month)) return;
                const p = postsObj[d] || {};
                const items = Array.isArray(p._items) ? p._items : [];
                out.posts += items.length;
                items.forEach(it => {
                    out.reach += +(it.reach || 0);
                    out.impressions += +(it.impressions || 0);
                    out.likes += +(it.likes || 0);
                    out.comments += +(it.comments || 0);
                    out.shares += +(it.shares || 0);
                    out.saves += +(it.saves || 0);
                    out.websiteClicks += +(it.websiteClicks || 0);
                });
            });
        } catch (e) { console.error('computeTotalsOnSnapshot', e); }
        return out;
    }
    window._computeTotalsOnSnapshot = computeTotalsOnSnapshot;

    // --- UI render for insight totals (below Export CSV Postingan) ---
    // --- UI render for insight totals (below Export CSV Postingan) ---
    function createInsightTotalsContainerIfMissing() {
        let wrap = document.getElementById('insightTotalsWrap');
        if (!wrap) {
            try {
                // find the "Export CSV Postingan" button by exact text (fallback to first export button)
                const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim().startsWith('Export CSV (Sesuai Filter)')) || Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').toLowerCase().includes('export csv post'));
                if (!btn) {
                    // fallback: append under monthFilter
                    const mf = document.getElementById('monthFilter');
                    if (!mf) return;
                    wrap = document.createElement('div');
                    wrap.id = 'insightTotalsWrap';
                    mf.parentNode.insertBefore(wrap, mf.nextSibling);
                } else {
                    wrap = document.createElement('div');
                    wrap.id = 'insightTotalsWrap';
                    btn.parentNode.insertBefore(wrap, btn.nextSibling);

                    // Custom scrollbar styling for webkit (inject once)
                    if (!document.getElementById('insightScrollStyle')) {
                        const style = document.createElement('style');
                        style.id = 'insightScrollStyle';
                        style.innerHTML = `
                            #insightTotalsWrap::-webkit-scrollbar { height: 6px; }
                            #insightTotalsWrap::-webkit-scrollbar-thumb { background: #bdbdbd; border-radius: 3px; }
                            #insightTotalsWrap::-webkit-scrollbar-track { background: #f0f0f0; }
                        `;
                        document.head.appendChild(style);
                    }
                }
            } catch (e) { console.error('createInsightTotalsContainerIfMissing', e); }
        }

        // Force styles every time to ensure single row layout
        if (wrap) {
            wrap.style.marginTop = '10px';
            wrap.style.display = 'flex';
            wrap.style.gap = '12px';
            wrap.style.flexWrap = 'nowrap'; // FORCE SINGLE ROW
            wrap.style.overflowX = 'auto'; // Horizontal scroll
            wrap.style.paddingBottom = '8px'; // Space for scrollbar
            wrap.style.alignItems = 'center';
            wrap.style.whiteSpace = 'nowrap';
            wrap.style.width = '100%'; // Ensure full width available
        }
        return wrap;
    }

    function mkBadgeHTML(label, value) {
        return `<div class="insight-badge" title="${label}" style="background:#fff; border:1px solid #e0e0e0; box-shadow:0 1px 3px rgba(0,0,0,0.08); padding:8px 14px; border-radius:8px; display:inline-flex; flex-direction:column; align-items:center; min-width:80px; flex-shrink:0;">
      <div style="font-size:15px; color:#1565C0; font-weight:700;">${String(value)}</div>
      <div style="font-size:11px; color:#555; margin-top:3px; font-weight:500;">${label}</div>
    </div>`;
    }

    window.updateStatsUI = function () {
        try {
            createInsightTotalsContainerIfMissing();
            const wrap = document.getElementById('insightTotalsWrap');
            if (!wrap) return;

            const month = document.getElementById('monthFilter')?.value || 'all';
            const totals = computeTotalsOnSnapshot(window.dataStore || {}, month);
            // determine initial followers (from earliest profile snapshot or legacy profile.start)
            function getInitialFollowers() {
                const snaps = Object.keys(dataStore.profileSnapshots || {}).sort();
                if (snaps.length > 0) {
                    const first = dataStore.profileSnapshots[snaps[0]] || {};
                    return first.followersStart || first.followersEnd || (dataStore.profile && dataStore.profile.followersStart) || 0;
                }
                return (dataStore.profile && dataStore.profile.followersStart) || 0;
            }
            const initialFollowers = getInitialFollowers();
            // build badges order: posts, reach, impressions, likes, comments, shares, saves, websiteClicks
            const html = [
                mkBadgeHTML('Postingan', totals.posts),
                mkBadgeHTML('Reach', totals.reach),
                mkBadgeHTML('Tayangan', totals.impressions),
                mkBadgeHTML('Suka', totals.likes),
                mkBadgeHTML('Komentar', totals.comments),
                mkBadgeHTML('Bagikan', totals.shares),
                mkBadgeHTML('Tersimpan', totals.saves),
                mkBadgeHTML('Website Clicks', totals.websiteClicks)
            ].join('');
            wrap.innerHTML = html;

            // Render the initial followers badge under the follower-growth calculator if placeholder exists
            try {
                const target = document.getElementById('initialFollowersBadgeWrap');
                if (target) target.innerHTML = mkBadgeHTML('Followers Awal', initialFollowers);
            } catch (e) { /* ignore */ }
        } catch (e) { console.error('updateStatsUI', e); }
    }

    // --- History Panel (collapsible / hide-show) ---
    function createHistoryPanelIfMissing() {
        if (document.getElementById('historyPanelWrap')) return;
        try {
            // Insert the history/undo UI at the bottom of the Insight Konten .content block
            const insightSections = Array.from(document.querySelectorAll('.content'));
            let target = null;
            // Find the section whose first h3 contains 'Insight Konten'
            for (const sec of insightSections) {
                const h3 = sec.querySelector('h3');
                if (h3 && (h3.textContent || '').trim().toLowerCase().includes('insight konten')) { target = sec; break; }
            }
            if (!target) target = document.body;

            const panel = document.createElement('div');
            panel.id = 'historyPanelWrap';
            // Sticky Footer Styles
            panel.style.position = 'fixed';
            panel.style.bottom = '0';
            panel.style.left = '0';
            panel.style.width = '100%';
            panel.style.backgroundColor = '#fff';
            panel.style.boxShadow = '0 -2px 10px rgba(0,0,0,0.1)';
            panel.style.padding = '10px 20px';
            panel.style.borderTop = '1px solid #ddd';
            panel.style.zIndex = '9999';
            panel.style.boxSizing = 'border-box';

            // Adjust body padding so footer doesn't cover content
            document.body.style.paddingBottom = '150px';

            panel.innerHTML = `
        <div style="display:flex; align-items:center; gap:20px; justify-content:flex-start; flex-wrap:wrap;">
          <!-- Group 1: History -->
          <div style="display:flex; align-items:center; gap:8px;">
            <button id="btn-undo" title="Undo" class="btn-secondary">↶ Undo</button>
            <button id="btn-redo" title="Redo" class="btn-secondary">↷ Redo</button>
            <button id="btn-save-snap" title="Save Snapshot" class="btn-secondary">💾 Snap</button>
            <button id="btn-clear-history" title="Clear History" class="btn-danger">🗑️ Clear</button>
            <button id="btn-toggle-log" title="Show/Hide History Log" class="btn-secondary">📜 Log</button>
          </div>
          
          <div style="width:1px; height:24px; background:#ddd;"></div>

          <!-- Group 2: File -->
          <div style="display:flex; align-items:center; gap:10px; font-size:13px;">
             <label id="loadJsonFooterBtn" class="btn-secondary" style="margin:0; padding:6px 12px; font-size:13px; font-weight:normal; border-radius:4px; cursor:pointer;" for="jsonFileFooter">📂 Load JSON</label>
             <input type="file" id="jsonFileFooter" accept=".json" style="display:none" onchange="window.loadJson(event)">
             <div style="color:#666; display:flex; align-items:center; gap:4px;">Last: <span id="lastEdited">-</span></div>
          </div>

          <div style="width:1px; height:24px; background:#ddd;"></div>

          <!-- Group 3: Options -->
          <div style="display:flex; align-items:center; gap:15px; font-size:13px;">
             <div style="display:flex; align-items:center; gap:4px;"><input type="checkbox" id="enableAutoSave" checked> <label for="enableAutoSave" style="cursor:pointer;">Auto-save</label></div>
             <button class="btn-secondary btn-small" onclick="exportJson()" title="Backup Data JSON">Export JSON</button>
             <button class="btn-success btn-small" style="background:#4caf50;color:#fff;border:none;" onclick="exportToExcel()" title="Export Laporan Excel">Export Excel</button>
          </div>
        </div>
        
        <div id="historyPanel" style="margin-top:8px; display:none; max-height:200px; overflow:auto; padding:6px; background:#fafafa; border-radius:6px; border:1px solid #eee;">
        </div>
      `;
            document.body.appendChild(panel);

            // Floating Toggle Button
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'floatingFooterToggle';
            toggleBtn.innerHTML = '☰'; // Hamburger icon or similar
            toggleBtn.title = 'Show/Hide Footer Controls';
            toggleBtn.style.position = 'fixed';
            toggleBtn.style.bottom = '20px';
            toggleBtn.style.right = '20px';
            toggleBtn.style.width = '50px';
            toggleBtn.style.height = '50px';
            toggleBtn.style.borderRadius = '25px';
            toggleBtn.style.backgroundColor = '#fff';
            toggleBtn.style.color = '#2196F3'; // Primary blue
            toggleBtn.style.fontSize = '24px';
            toggleBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            toggleBtn.style.border = 'none';
            toggleBtn.style.cursor = 'pointer';
            toggleBtn.style.zIndex = '10000';
            toggleBtn.style.display = 'flex';
            toggleBtn.style.alignItems = 'center';
            toggleBtn.style.justifyContent = 'center';
            toggleBtn.style.transition = 'all 0.3s ease';

            toggleBtn.onclick = function () {
                const p = document.getElementById('historyPanelWrap');
                if (p) {
                    if (p.style.display === 'none') {
                        p.style.display = 'block';
                        toggleBtn.innerHTML = '✖'; // Close icon
                        toggleBtn.style.backgroundColor = '#2196F3';
                        toggleBtn.style.color = '#fff';
                    } else {
                        p.style.display = 'none';
                        toggleBtn.innerHTML = '☰'; // Menu icon
                        toggleBtn.style.backgroundColor = '#fff';
                        toggleBtn.style.color = '#2196F3';
                    }
                }
            };
            document.body.appendChild(toggleBtn);

            // wire basic buttons
            document.getElementById('btn-undo')?.addEventListener('click', function () { if (typeof window.undo === 'function') window.undo(); });
            document.getElementById('btn-redo')?.addEventListener('click', function () { if (typeof window.redo === 'function') window.redo(); });
            document.getElementById('btn-save-snap')?.addEventListener('click', function () { if (typeof window.pushHistory === 'function') window.pushHistory('manual snapshot'); });
            document.getElementById('btn-clear-history')?.addEventListener('click', function () { if (typeof window.clearHistory === 'function') window.clearHistory(); });

            // Attention animation for Load JSON footer button
            (function attachLoadJsonAttention() {
                // select by id or fallback to attribute selector
                const btn = document.getElementById('loadJsonFooterBtn') || document.querySelector('label[for="jsonFileFooter"]');
                if (!btn) return;
                // enable continuous stroke loop
                btn.classList.add('stroke-loop');
                // also keep a short pop highlight when triggered programmatically
                btn.addEventListener('animationend', function (ev) {
                    // ensure we only remove transient pulse-attention (not the stroke-loop)
                    if (ev.animationName === 'popHighlight') btn.classList.remove('pulse-attention');
                });
                // expose a manual trigger for pulse highlight
                window.triggerLoadJsonAttention = function () {
                    const el = document.getElementById('loadJsonFooterBtn') || document.querySelector('label[for="jsonFileFooter"]');
                    if (!el) return;
                    el.classList.remove('pulse-attention');
                    // force reflow to allow re-adding the class
                    void el.offsetWidth;
                    el.classList.add('pulse-attention');
                };
            })();

            // Toggle Log
            document.getElementById('btn-toggle-log')?.addEventListener('click', function () {
                const hp = document.getElementById('historyPanel');
                if (hp) {
                    const isHidden = hp.style.display === 'none';
                    hp.style.display = isHidden ? 'block' : 'none';
                    this.style.background = isHidden ? '#bbb' : ''; // visual feedback
                    this.style.color = isHidden ? '#fff' : '';
                }
            });
        } catch (e) { console.error('createHistoryPanelIfMissing', e); }
    }

    function formatIsoShort(iso) {
        if (!iso) return '-';
        try {
            const d = new Date(iso);
            return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') + ':' + d.getSeconds().toString().padStart(2, '0');
        } catch (e) { return iso; }
    }

    // Render the history panel listing undo stack (chronological) and redo stack
    function updateHistoryPanel() {
        try {
            createHistoryPanelIfMissing();
            const container = document.getElementById('historyPanel');
            if (!container) return;
            container.innerHTML = '';

            const undo = Array.isArray(window._undoStack) ? window._undoStack : [];
            const meta = Array.isArray(window._historyMeta) ? window._historyMeta : [];

            // Action Label Map
            const actionLabels = {
                'saveData': 'Data Saved',
                'addPostItem': 'Post Added',
                'deleteData': 'Post Deleted',
                'deletePostItem': 'Post Deleted',
                'loadJson': 'JSON Loaded',
                'saveProfileSnapshot': 'Snapshot Saved',
                'deleteProfileSnapshot': 'Snapshot Deleted',
                'saveEditData': 'Edit Saved',
                'regenerateAllTags': 'Tags Regenerated',
                'importFromExtension': 'Imported Data',
                'manual snapshot': 'Manual Snapshot',
                'initial': 'Initial State',
                'auto': 'Auto-Save'
            };

            const makeEntry = (snap, idx, side) => {
                // Get label from meta, fallback to generic
                const rawLabel = meta[idx]?.label;
                const displayLabel = actionLabels[rawLabel] || rawLabel || 'Change';
                const ts = formatIsoShort(meta[idx]?.ts || meta[idx]?.time || meta[idx]?.timestamp || new Date().toISOString());

                const entry = document.createElement('div');
                entry.style.display = 'flex';
                entry.style.alignItems = 'center';
                entry.style.justifyContent = 'space-between';
                entry.style.padding = '8px';
                entry.style.borderBottom = '1px solid #eee';
                entry.style.fontSize = '12px';
                entry.innerHTML = `
          <div style="display:flex; gap:10px; align-items:center;">
            <div style="font-weight:bold; color:${side === 'undo' ? '#2196F3' : '#FF9800'}; width:24px;">${side === 'undo' ? 'U' : 'R'}${idx}</div>
            <div style="color:#333; font-weight:600;">${escapeHtml(displayLabel)}</div>
            <div style="color:#999;">${ts}</div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-restore btn-small" data-side="${side}" data-idx="${idx}" title="Restore this state">Restore</button>
          </div>
        `;
                return entry;
            };

            const uWrap = document.createElement('div');
            uWrap.innerHTML = `<div style="font-weight:600;margin-bottom:6px;font-size:12px;color:#666;">Undo Stack (${undo.length})</div>`;
            if (!undo.length) {
                const n = document.createElement('div'); n.className = 'muted'; n.textContent = 'Tidak ada entry'; uWrap.appendChild(n);
            } else {
                // show last 30 entries most-recent-first for usability but allow restore by index
                for (let i = undo.length - 1; i >= 0; i--) {
                    const entry = makeEntry(undo[i], i, 'undo');
                    uWrap.appendChild(entry);
                }
            }
            container.appendChild(uWrap);

            const redo = Array.isArray(window._redoStack) ? window._redoStack : [];
            if (redo.length > 0) {
                const rWrap = document.createElement('div');
                rWrap.style.marginTop = '8px';
                rWrap.innerHTML = `<div style="font-weight:600;margin-bottom:6px;font-size:12px;color:#666;">Redo Stack (${redo.length})</div>`;
                for (let i = 0; i < redo.length; i++) {
                    const metaIdx = (undo.length + i);
                    const entry = makeEntry(redo[i], metaIdx, 'redo');
                    rWrap.appendChild(entry);
                }
                container.appendChild(rWrap);
            }

            // wire buttons
            container.querySelectorAll('.btn-restore').forEach(btn => {
                btn.addEventListener('click', function () {
                    const side = this.getAttribute('data-side');
                    const idx = parseInt(this.getAttribute('data-idx'), 10);
                    if (side === 'undo') {
                        // restore the chosen undo snapshot: set undo stack top to that index
                        if (isNaN(idx)) return;
                        // Move newest snapshots into redo stack until top is idx
                        while (window._undoStack.length - 1 > idx) {
                            window._redoStack.unshift(window._undoStack.pop());
                            window._historyMetaShifted = window._historyMeta.pop();
                        }
                        const toRestore = window._undoStack[window._undoStack.length - 1];
                        if (toRestore) {
                            restoreSnapshot(toRestore);
                            updateHistoryPanel();
                            try { if (typeof updateUndoRedoButtons === 'function') updateUndoRedoButtons(); } catch (e) { }
                        }
                    } else {
                        // redo side
                        const redoIdxRelative = idx - (window._undoStack.length);
                        if (redoIdxRelative < 0 || redoIdxRelative >= window._redoStack.length) return;
                        for (let i = 0; i <= redoIdxRelative; i++) {
                            window._undoStack.push(window._redoStack.shift());
                        }
                        const toRestore = window._undoStack[window._undoStack.length - 1];
                        if (toRestore) {
                            restoreSnapshot(toRestore);
                            updateHistoryPanel();
                            try { if (typeof updateUndoRedoButtons === 'function') updateUndoRedoButtons(); } catch (e) { }
                        }
                    }
                });
            });

        } catch (e) { console.error('updateHistoryPanel', e); }
    }
    window.updateHistoryPanel = updateHistoryPanel;


    // safe escape HTML for inspect viewer
    function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, function (m) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]; }); }

    // core history/undo/redo implementation
    (function historyCore() {
        window._undoStack = window._undoStack || [];
        window._redoStack = window._redoStack || [];
        window._historyMeta = window._historyMeta || [];
        const maxHistory = 60;

        function deepClone(obj) {
            try { return (typeof structuredClone === 'function') ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)); }
            catch (e) { return JSON.parse(JSON.stringify(obj)); }
        }

        // restore snapshot (full replace)
        window.restoreSnapshot = function (snap) {
            try {
                if (!snap) return;
                window.dataStore = deepClone(snap);
                // ensure normalized structures and UI refresh
                if (typeof normalizePostsStructure === 'function') normalizePostsStructure();
                if (typeof generateMonthOptions === 'function') generateMonthOptions();
                if (typeof generateProfileMonthOptions === 'function') generateProfileMonthOptions();
                if (typeof renderProfileInputs === 'function') renderProfileInputs();
                if (typeof renderUsernameAreas === 'function') renderUsernameAreas();
                if (typeof renderTableFiltered === 'function') renderTableFiltered();
                if (typeof renderTagCloud === 'function') renderTagCloud();
                if (typeof updateMonthlyReachDisplay === 'function') updateMonthlyReachDisplay();
                if (typeof updateMonthlyImpressionsDisplay === 'function') updateMonthlyImpressionsDisplay();
                // re-render posts list for currently selected date
                const curDate = document.getElementById('dateInput')?.value;
                if (curDate && typeof renderPostItemsForDate === 'function') renderPostItemsForDate(curDate);
                // update global visuals
                if (typeof updateStatsUI === 'function') updateStatsUI();
                if (typeof updateHistoryPanel === 'function') updateHistoryPanel();
                if (typeof showSaveNotification === 'function') showSaveNotification('Snapshot diterapkan');
            } catch (e) { console.error('restoreSnapshot', e); }
        };

        // push a new snapshot (should be called after mutation)
        window.pushHistory = function (label) {
            try {
                const snap = deepClone(window.dataStore || {});
                // if nothing in undo or last snapshot is different, push
                const last = window._undoStack.length ? window._undoStack[window._undoStack.length - 1] : null;
                const lastStr = last ? JSON.stringify(last) : null;
                const curStr = JSON.stringify(snap);
                if (lastStr === curStr && window._undoStack.length) {
                    // identical to last snapshot -> update timestamp instead
                    window._historyMeta[window._historyMeta.length - 1] = { ts: new Date().toISOString(), label: label || 'auto' };
                } else {
                    window._undoStack.push(snap);
                    window._historyMeta.push({ ts: new Date().toISOString(), label: label || 'auto' });
                    // trim if exceed max
                    while (window._undoStack.length > maxHistory) {
                        window._undoStack.shift();
                        window._historyMeta.shift();
                    }
                    // clear redo on new push
                    window._redoStack = [];
                }
                updateHistoryPanel();
                try { if (typeof updateUndoRedoButtons === 'function') updateUndoRedoButtons(); } catch (e) { }
            } catch (e) { console.error('pushHistory', e); }
        };

        // undo: move last snapshot to redo and restore previous
        window.undo = function () {
            try {
                if (!window._undoStack || window._undoStack.length < 2) { alert('Tidak ada yang dapat di-undo'); return; }
                const last = window._undoStack.pop();
                const lastMeta = window._historyMeta.pop();
                window._redoStack.unshift(last);
                // Note: we keep a mirror of meta for redo as well (put meta at front)
                window._redoMeta = window._redoMeta || [];
                window._redoMeta.unshift(lastMeta);
                const toRestore = window._undoStack[window._undoStack.length - 1];
                restoreSnapshot(toRestore);
                updateHistoryPanel();
                try { if (typeof updateUndoRedoButtons === 'function') updateUndoRedoButtons(); } catch (e) { }
            } catch (e) { console.error('undo', e); alert('Undo gagal'); }
        };

        // redo: take first redo snapshot and apply it (push to undo)
        window.redo = function () {
            try {
                if (!window._redoStack || window._redoStack.length === 0) { alert('Tidak ada yang dapat di-redo'); return; }
                const snap = window._redoStack.shift();
                const meta = (window._redoMeta && window._redoMeta.length) ? window._redoMeta.shift() : { ts: new Date().toISOString(), label: 'redo' };
                window._undoStack.push(snap);
                window._historyMeta.push(meta);
                restoreSnapshot(snap);
                updateHistoryPanel();
                try { if (typeof updateUndoRedoButtons === 'function') updateUndoRedoButtons(); } catch (e) { }
            } catch (e) { console.error('redo', e); alert('Redo gagal'); }
        };

        // clear history helper
        window.clearHistory = function () {
            window._undoStack = [];
            window._redoStack = [];
            window._historyMeta = [];
            updateHistoryPanel();
        };

        // expose for debug
        window._deepClone = deepClone;

    })();

    // --- Wrap pushHistory to record timestamps in parallel array (legacy compatibility removed) ---
    (function wrapPushHistory() {
        try {
            // ensure initial baseline exists
            if (!Array.isArray(window._undoStack) || window._undoStack.length === 0) {
                try { window.pushHistory('initial'); } catch (e) { }
            }
        } catch (e) { console.error('wrapPushHistory', e); }
    })();

    // --- Wrap mutator functions to refresh stats & history panel after they run ---
    (function wrapMutators() {
        const names = ['saveData', 'addPostItem', 'deleteData', 'deletePostItem', 'loadJson',
            'saveProfileSnapshot', 'deleteProfileSnapshot',
            'saveEditData', 'regenerateAllTags', 'importFromExtension'];
        names.forEach(n => {
            try {
                const orig = window[n];
                if (typeof orig === 'function') {
                    window[n] = function (...args) {
                        // call original
                        const res = orig.apply(this, args);
                        try {
                            // push history snapshot after mutation; use a short timeout to ensure any DOM reads are settled
                            setTimeout(function () { try { window.pushHistory(n); } catch (e) { console.error('pushHistory after ' + n, e); } }, 10);
                        } catch (e) { console.error('after wrap ' + n, e); }
                        return res;
                    };
                }
            } catch (e) { /* ignore */ }
        });
    })();

    // ensure history UI created and initial snapshot present on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function () {
        try {
            createHistoryPanelIfMissing();
            if (!window._undoStack || window._undoStack.length === 0) window.pushHistory('initial');
            updateHistoryPanel();
            updateStatsUI();
            // update when monthFilter changed
            document.getElementById('monthFilter')?.addEventListener('change', function () { updateStatsUI(); updateHistoryPanel(); updateMonthlyReachDisplay(); updateMonthlyImpressionsDisplay(); });

            // keyboard shortcuts for undo/redo:
            // - Ctrl/Cmd+Z => undo
            // - Ctrl/Cmd+Y OR Ctrl/Cmd+Shift+Z => redo
            function handleHistoryKeyboard(e) {
                try {
                    const mod = e.ctrlKey || e.metaKey;
                    if (!mod) return;
                    const key = (e.key || '').toLowerCase();
                    if (key === 'z' && !e.shiftKey) {
                        e.preventDefault();
                        if (typeof window.undo === 'function') window.undo();
                    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
                        e.preventDefault();
                        if (typeof window.redo === 'function') window.redo();
                    }
                } catch (err) { console.error('history keyboard handler', err); }
            }
            // Attach once to document
            document.addEventListener('keydown', handleHistoryKeyboard);

        } catch (e) { console.error('history/stats init', e); }
    });

})();



