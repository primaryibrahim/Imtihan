/**
 * Imtihanati Exam Editor - Refactored with ExamManager Pattern
 * Architecture improvements: centralized state, auto-save, image compression,
 * synchronous pagination, and security sanitization.
 */

// ============================================================================
// ExamManager - Centralized State Management
// ============================================================================
const ExamManager = {
    // Firebase Configuration
    firebaseConfig: {
        apiKey: "AIzaSyAE3yRs93rVVoKkMtLMv8s3fBeYM_31JDs",
        authDomain: "al-imtihan.firebaseapp.com",
        projectId: "al-imtihan",
        storageBucket: "al-imtihan.firebasestorage.app",
        messagingSenderId: "713378838175",
        appId: "1:713378838175:web:c1f61ca687867ea099d4aa",
        measurementId: "G-YWXPF37WMC"
    },
    db: null,

    initFirebase() {
        if (typeof firebase !== 'undefined') {
            try {
                if (!firebase.apps.length) {
                    firebase.initializeApp(this.firebaseConfig);
                }
                this.db = firebase.firestore();
                console.log('Firebase initialized (Compat Mode)');
            } catch (e) {
                console.error('Firebase Init Error:', e);
            }
        }
    },

    // --- Firebase Shared Exams ---
    async shareExam(examData) {
        if (!this.db) {
            console.warn('Firebase DB not initialized. Using local.');
            return { success: false, error: 'Firebase not connected' };
        }
        try {
            const docRef = await this.db.collection('exams').add({
                title: examData.title,
                author: examData.author,
                questions: examData.questions,
                header: examData.header,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                downloads: 0,
                likes: 0
            });
            return { success: true, id: docRef.id };
        } catch (error) {
            console.error('Share error:', error);
            return { success: false, error: error.message };
        }
    },

    async getCommunityExams(filters = {}) {
        if (!this.db) return [];
        try {
            let ref = this.db.collection('exams');
            // Basic ordering
            let q = ref.orderBy('createdAt', 'desc').limit(filters.limit || 50);

            // Apply filters
            if (filters.subject) q = q.where('header.subject', '==', filters.subject);
            if (filters.grade) q = q.where('header.grade', '==', filters.grade);
            if (filters.country) q = q.where('header.country', '==', filters.country);
            if (filters.period) q = q.where('header.period', '==', filters.period);
            if (filters.semester) q = q.where('header.semester', '==', filters.semester);

            const snapshot = await q.get();
            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    // Handle timestamp conversion safely
                    createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : new Date()
                };
            });
        } catch (error) {
            console.error('Error loading exams:', error);
            return [];
        }
    },

    async deleteExam(examId) {
        if (!this.db) return { success: false, error: 'Firebase not connected' };
        if (!this.state.adminHash) return { success: false, error: 'Unauthorized' };

        try {
            await this.db.collection('exams').doc(examId).delete();
            return { success: true };
        } catch (error) {
            console.error('Delete error:', error);
            return { success: false, error: error.message };
        }
    },

    state: {
        questions: [],
        meta: {
            mcqCount: 0,
            questionCounter: 0
        },
        settings: {
            isLTR: false,
            mathMode: false
        },
        editing: {
            currentIndex: -1,
            creationPairs: [],
            essayBranches: []
        },
        isAdmin: false,
        draftPromptedThisSession: false,
        sessionID: Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    },

    renderingQueue: [],
    isRendering: false,
    renderRequested: false,
    mathField: null,
    isPaperViewActive: false,

    // --- Core Question Methods ---
    addQuestion(question) {
        // Issue 2: Deep copy to protect nested data
        const qCopy = JSON.parse(JSON.stringify(question));
        qCopy.id = Date.now();
        this.state.questions.push(qCopy);
        this.requestRender();
        this.saveDraft();
    },

    deleteQuestion(index) {
        customConfirm('حذف السؤال', 'هل أنت متأكد من حذف هذا السؤال؟', () => {
            this.state.questions.splice(index, 1);
            this.requestRender();
            this.saveDraft();
        }, 'fa-trash');
    },

    updateQuestion(index, data) {
        if (index >= 0 && index < this.state.questions.length) {
            // Issue 2: Deep copy for update
            this.state.questions[index] = JSON.parse(JSON.stringify({ ...this.state.questions[index], ...data }));
            this.requestRender();
            this.saveDraft();
        }
    },

    getQuestions() {
        return this.state.questions;
    },

    getDraftKey() {
        return `imtihanati_draft_${this.state.sessionID}`;
    },

    saveDraft() {
        if (this.state.questions.length === 0) return;
        try {
            const draft = {
                questions: this.state.questions,
                header: this.getHeaderData(),
                timestamp: Date.now()
            };
            localStorage.setItem(this.getDraftKey(), JSON.stringify(draft));
            // Backup for cross-session recovery
            localStorage.setItem('imtihanati_draft_last', JSON.stringify(draft));
        } catch (e) {
            console.warn('Failed to save draft:', e.message);
        }
    },

    loadDraft() {
        if (this.state.draftPromptedThisSession) return false;
        this.state.draftPromptedThisSession = true;

        try {
            // Check session key first, then last known global draft
            const draftRaw = localStorage.getItem(this.getDraftKey()) || localStorage.getItem('imtihanati_draft_last');
            if (draftRaw) {
                const data = JSON.parse(draftRaw);
                const age = Date.now() - data.timestamp;
                if (age < 86400000 && data.questions.length > 0) {
                    customConfirm('استعادة المسودة', 'تم العثور على مسودة محفوظة. هل تريد استعادتها؟', () => {
                        this.state.questions = data.questions;
                        this.restoreHeader(data.header);
                        const maker = document.getElementById('maker-screen');
                        if (maker.style.display !== 'grid') {
                            maker.style.display = 'grid';
                            document.getElementById('hero').style.display = 'none';
                            document.getElementById('pre-written-screen').style.display = 'none';
                        }
                        this.requestRender();
                    }, 'fa-history');
                    return true;
                }
            }
        } catch (e) {
            console.warn('Failed to load draft:', e.message);
        }
        return false;
    },

    clearDraft() {
        localStorage.removeItem('imtihanati_draft');
    },

    getHeaderData() {
        const fields = ['subject', 'grade', 'teacher', 'date', 'time', 'score', 'title', 'ministry', 'school', 'directorate', 'country', 'semester', 'period'];
        const data = {};
        fields.forEach(field => {
            const el = document.getElementById('input-' + field);
            if (el) data[field] = el.value;
        });
        return data;
    },

    restoreHeader(data) {
        if (!data) return;
        Object.keys(data).forEach(field => {
            const el = document.getElementById('input-' + field);
            if (el) el.value = data[field];
        });
        syncHeader();
        changeCountry();
    },

    // --- Issue 1 & 6: Robust Sequential Rendering ---
    async requestRender() {
        if (this.isRendering) {
            this.renderRequested = true;
            return;
        }
        this.isRendering = true;
        this.renderRequested = false;

        try {
            renderQuestionList();
            await renderExamPaper();

            if (window.MathJax && window.MathJax.typesetPromise) {
                await window.MathJax.typesetPromise();
            }
        } catch (err) {
            console.error('Render error:', err);
        } finally {
            this.isRendering = false;
            // If another render was requested while we were busy, run it now
            if (this.renderRequested) {
                this.requestRender();
            }
        }
    },

    // --- Creation Pairs for Connect Questions ---
    addCreationPair(a, b) {
        this.state.editing.creationPairs.push({ a, b });
    },

    clearCreationPairs() {
        this.state.editing.creationPairs = [];
    },

    getCreationPairs() {
        return this.state.editing.creationPairs;
    },

    deleteCreationPair(index) {
        this.state.editing.creationPairs.splice(index, 1);
    },

    updateCreationPair(index, field, value) {
        if (this.state.editing.creationPairs[index]) {
            this.state.editing.creationPairs[index][field] = value;
        }
    },

    // --- Essay Branches Methods ---
    addEssayBranch(text) {
        this.state.editing.essayBranches.push({ text: text || '' });
    },

    clearEssayBranches() {
        this.state.editing.essayBranches = [];
        // Reset to default 2 branches
        this.addEssayBranch('');
        this.addEssayBranch('');
    },

    getEssayBranches() {
        return this.state.editing.essayBranches;
    },

    deleteEssayBranch(index) {
        this.state.editing.essayBranches.splice(index, 1);
    },

    updateEssayBranch(index, text) {
        if (this.state.editing.essayBranches[index]) {
            this.state.editing.essayBranches[index].text = text;
        }
    }
};

// ============================================================================
// Custom UI Helpers (Issue 10)
// ============================================================================
function customConfirm(title, message, onConfirm, icon = 'fa-question-circle', onCancel = null) {
    const modal = document.getElementById('custom-alert-modal');
    document.getElementById('custom-alert-title').textContent = title;
    document.getElementById('custom-alert-message').textContent = message;
    document.getElementById('custom-alert-icon').className = 'fas ' + icon;

    const cancelBtn = document.getElementById('custom-alert-cancel');
    const okBtn = document.getElementById('custom-alert-confirm');

    cancelBtn.style.display = 'block';

    const cleanup = () => {
        okBtn.removeEventListener('click', confirmHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
        hideModal('custom-alert-modal');
    };

    const confirmHandler = () => { cleanup(); if (onConfirm) onConfirm(); };
    const cancelHandler = () => { cleanup(); if (onCancel) onCancel(); };

    okBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);

    showModal('custom-alert-modal');
}

function customAlert(title, message, icon = 'fa-info-circle') {
    const modal = document.getElementById('custom-alert-modal');
    document.getElementById('custom-alert-title').textContent = title;
    document.getElementById('custom-alert-message').textContent = message;
    document.getElementById('custom-alert-icon').className = 'fas ' + icon;

    document.getElementById('custom-alert-cancel').style.display = 'none';
    const okBtn = document.getElementById('custom-alert-confirm');

    const handler = () => {
        okBtn.removeEventListener('click', handler);
        hideModal('custom-alert-modal');
    };
    okBtn.addEventListener('click', handler);

    showModal('custom-alert-modal');
}

function customPromptAdmin() {
    const modal = document.getElementById('custom-prompt-modal');
    const input = document.getElementById('custom-prompt-input');
    const okBtn = document.getElementById('custom-prompt-submit');

    input.value = '';

    const handler = async () => {
        const pass = input.value;
        if (!pass) return;

        okBtn.removeEventListener('click', handler);
        hideModal('custom-prompt-modal');

        const encoder = new TextEncoder();
        const data = encoder.encode(pass);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        const targetHash = 'bbd7182cd0ee95488f1a1e6f3fe0d8f94ed0d14e4db1dce713fe82a3231c523d';

        if (hashHex === targetHash) {
            ExamManager.state.isAdmin = true;
            ExamManager.state.adminHash = hashHex;
            customAlert('نجاح', 'تم تفعيل وضع المدير بنجاح', 'fa-check-circle');
            document.getElementById('admin-login-btn').classList.add('active');
            loadCommunityExams();
        } else {
            customAlert('خطأ', 'كلمة مرور خاطئة', 'fa-exclamation-triangle');
        }
    };

    okBtn.addEventListener('click', handler);
    showModal('custom-prompt-modal');
}

// Issue 9: LocalStorage Quota Guard
function checkStorageQuota(dataSize) {
    try {
        const currentSize = JSON.stringify(localStorage).length;
        const limit = 5 * 1024 * 1024; // 5MB approx
        if (currentSize + dataSize > limit * 0.9) {
            customAlert('تحذير المساحة', 'مساحة التخزين المحلية ممتلئة تقريباً. قد لا يتم حفظ المسودات الكبيرة بشكل صحيح.', 'fa-exclamation-triangle');
        }
    } catch (e) { }
}

// ============================================================================
// View Switching Functions
// ============================================================================
// Flag to skip draft prompt when importing
let skipDraftPrompt = false;

function switchView(view) {
    const hero = document.getElementById('hero');
    const maker = document.getElementById('maker-screen');
    const preWritten = document.getElementById('pre-written-screen');

    hero.style.display = 'none';
    maker.style.display = 'none';
    preWritten.style.display = 'none';

    if (view === 'maker') {
        maker.style.display = 'grid';
        document.body.style.overflow = 'hidden';

        // Only prompt for draft when entering maker (not on import)
        if (!skipDraftPrompt) {
            setTimeout(() => {
                ExamManager.loadDraft();
                setTimeout(() => {
                    if (typeof updateMobilePreview === 'function') updateMobilePreview();
                }, 500);
            }, 300);
        }
        initAdUnits(maker);
        skipDraftPrompt = false; // Reset flag
    } else {
        preWritten.style.display = 'block';
        document.body.style.overflow = 'auto';
        loadCommunityExams();
        checkEmptyState();
        initAdUnits(preWritten);
    }
}

function resetView() {
    document.getElementById('hero').style.display = 'flex';
    document.getElementById('maker-screen').style.display = 'none';
    document.getElementById('pre-written-screen').style.display = 'none';
    document.body.style.overflow = 'auto';
}

function toggleUIPanel() {
    const panel = document.getElementById('ui-panel');
    panel.classList.toggle('mobile-hidden');
    const btn = document.querySelector('.mobile-toggle-btn span');
    if (btn) {
        btn.innerText = panel.classList.contains('mobile-hidden') ? 'واجهة التحكم' : 'عرض ورقي';
    }
}

function toggleViewerSidebar() {
    const sidebar = document.getElementById('viewer-sidebar');
    if (sidebar) sidebar.classList.toggle('mobile-hidden');
}

function toggleMobilePaperView() {
    const panel = document.getElementById('ui-panel');
    const preview = document.getElementById('mobile-paper-preview');
    const previewLabel = preview ? preview.querySelector('.preview-label') : null;
    const makerScreen = document.getElementById('maker-screen');
    const paperContainer = document.getElementById('exam-paper');

    ExamManager.isPaperViewActive = !ExamManager.isPaperViewActive;

    // Handler for clicking corner panel to toggle back
    const panelClickHandler = (e) => {
        // Only trigger if clicking the panel header area (::before pseudo element area)
        if (e.target === panel || e.target.closest('.ui-panel') === panel) {
            const rect = panel.getBoundingClientRect();
            // Check if clicking in top 50px (where the "اضغط للعودة" text is)
            if (e.clientY - rect.top < 50) {
                toggleMobilePaperView();
            }
        }
    };

    if (ExamManager.isPaperViewActive) {
        // Switch to preview mode: paper is main, controls in corner
        makerScreen.classList.add('preview-mode');
        panel.classList.add('corner-mode');
        panel.classList.remove('mobile-hidden');
        if (paperContainer) paperContainer.classList.add('main-view');
        if (preview) preview.classList.add('viewing-paper');
        if (previewLabel) previewLabel.textContent = 'التحكم';

        // FORCE RENDER: Fix pagination visualization on mobile
        // Since editor mode hides paper (height=0), we must re-calculate flow now that it's visible.
        ExamManager.requestRender();

        // Add click handler to panel for going back
        panel.addEventListener('click', panelClickHandler);
        panel._toggleHandler = panelClickHandler;
    } else {
        // Switch back to editor mode: controls main, paper secondary
        makerScreen.classList.remove('preview-mode');
        panel.classList.remove('corner-mode');
        if (paperContainer) paperContainer.classList.remove('main-view');
        if (preview) preview.classList.remove('viewing-paper');
        if (previewLabel) previewLabel.textContent = 'معاينة';

        // Remove click handler
        if (panel._toggleHandler) {
            panel.removeEventListener('click', panel._toggleHandler);
            delete panel._toggleHandler;
        }
    }
}

// ============================================================================
// MathQuill Handling
// ============================================================================
function toggleMathEditor() {
    const isChecked = document.getElementById('math-editor-toggle').checked;
    const container = document.getElementById('mathquill-editor-container');
    container.style.display = isChecked ? 'block' : 'none';

    if (isChecked && !ExamManager.mathField) {
        const MQ = MathQuill.getInterface(2);
        const mathFieldEl = document.getElementById('math-field');
        ExamManager.mathField = MQ.MathField(mathFieldEl, {
            spaceBehavesLikeTab: true,
            handlers: { edit: function () { } }
        });
    }
}

function insertMath(targetId) {
    if (!ExamManager.mathField) return;
    const latex = ExamManager.mathField.latex();
    if (!latex) return;
    const textarea = document.getElementById(targetId);
    if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const mathText = `$${latex}$`;
        textarea.value = text.substring(0, start) + mathText + text.substring(end);
        textarea.focus();
    }
}

function clearMath() {
    if (ExamManager.mathField) ExamManager.mathField.latex('');
}

function writeMQ(latex) {
    if (!ExamManager.mathField) return;
    ExamManager.mathField.write(latex);
    ExamManager.mathField.focus();
}

function switchMathTab(category) {
    const buttons = document.querySelectorAll('.symbol-tabs .tab-btn');
    buttons.forEach(btn => {
        if (btn.innerText.toLowerCase().includes(category) ||
            (category === 'basic' && btn.innerText.includes('أساسي')) ||
            (category === 'calculus' && btn.innerText.includes('تفاضل')) ||
            (category === 'chem' && btn.innerText.includes('كيمياء')) ||
            (category === 'greek' && btn.innerText.includes('يوناني')) ||
            (category === 'geom' && btn.innerText.includes('هندسة'))
        ) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const grids = document.querySelectorAll('.symbol-grid');
    grids.forEach(grid => {
        grid.style.display = grid.id === `tab-${category}` ? 'grid' : 'none';
    });
}

// ============================================================================
// Modal Functions
// ============================================================================
function showModal(id) {
    const modal = document.getElementById(id);
    modal.style.display = 'flex';
    initAdUnits(modal);
}
function hideModal(id) { document.getElementById(id).style.display = 'none'; }

// Helper to initialize AdSense in a specific container only when shown
function initAdUnits(container) {
    if (!container) return;
    // Find all ad units in this container that haven't been pushed yet
    const ads = container.querySelectorAll('.adsbygoogle:not([data-adsbygoogle-status])');
    if (ads.length > 0) {
        // Short delay to ensure browser has calculated dimensions
        setTimeout(() => {
            ads.forEach(ad => {
                // CRITICAL: Only push if the ad element is visible and has width
                // This prevents errors when ads are hidden via CSS media queries
                if (ad.offsetWidth > 0 && ad.offsetHeight > 0) {
                    try {
                        (adsbygoogle = window.adsbygoogle || []).push({});
                    } catch (e) {
                        console.error('AdSense push error:', e);
                    }
                }
            });
        }, 100);
    }
}

// ============================================================================
// Header & Country Functions
// ============================================================================
function checkEmptyState() {
    const grid = document.getElementById('exams-grid');
    const empty = document.getElementById('empty-state');
    if (grid && empty) {
        // Logic: Only show empty if grid has NO children
        empty.style.display = grid.children.length === 0 ? 'flex' : 'none';
    }
}


function changeCountry() {
    const country = document.getElementById('input-country').value;
    const logo = document.getElementById('country-logo');
    const ministryInput = document.getElementById('input-ministry');

    // Local country logos mapping
    const brands = {
        jordan: {
            logo: "CountryLogo/شعار_وزارة_التربية_الأردنية.jpg",
            ministry: "وزارة التربية والتعليم"
        },
        saudi: {
            logo: "CountryLogo/السعودية.svg",
            ministry: "وزارة التعليم"
        },
        palestine: {
            logo: "CountryLogo/فلسطين.svg",
            ministry: "وزارة التربية والتعليم العالي"
        },
        egypt: {
            logo: "CountryLogo/مصر.png",
            ministry: "وزارة التربية والتعليم والتعليم الفني"
        },
        uae: {
            logo: "CountryLogo/الامارات.png",
            ministry: "وزارة التربية والتعليم"
        },
        bahrain: {
            logo: "CountryLogo/البحرين.png",
            ministry: "وزارة التربية والتعليم"
        },
        algeria: {
            logo: "CountryLogo/الجزائر.svg",
            ministry: "وزارة التربية الوطنية"
        },
        iraq: {
            logo: "CountryLogo/العراق.svg",
            ministry: "وزارة التربية"
        },
        yemen: {
            logo: "CountryLogo/اليمن.png",
            ministry: "وزارة التربية والتعليم"
        },
        syria: {
            logo: "CountryLogo/سوريا.png",
            ministry: "وزارة التربية"
        },
        oman: {
            logo: "CountryLogo/عُمان.gif",
            ministry: "وزارة التربية والتعليم"
        },
        qatar: {
            logo: "CountryLogo/قطر.jpg",
            ministry: "وزارة التعليم والتعليم العالي"
        },
        kuwait: {
            logo: "CountryLogo/كويت.jpg",
            ministry: "وزارة التربية"
        },
        lebanon: {
            logo: "CountryLogo/لبنان.jpg",
            ministry: "وزارة التربية والتعليم العالي"
        },
        libya: {
            logo: "CountryLogo/ليبيا.jpeg",
            ministry: "وزارة التربية والتعليم"
        }
    };

    if (brands[country]) {
        // Add error handling for logo loading
        logo.onerror = function () {
            console.warn(`Failed to load logo for ${country}, using placeholder`);
            this.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="65" height="65" viewBox="0 0 65 65"><rect fill="%23f0f0f0" width="65" height="65"/><text x="32" y="38" text-anchor="middle" fill="%23999" font-size="10">Logo</text></svg>';
        };
        logo.src = brands[country].logo;
        ministryInput.value = brands[country].ministry;
        syncHeader();
    }
}

// ============================================================================
// Question Type Handling
// ============================================================================
function handleQuestionTypeChange() {
    const type = document.getElementById('question-type').value.trim();
    const mcqGroup = document.getElementById('mcq-options-group');
    const connectGroup = document.getElementById('connect-options-group');
    const essayGroup = document.getElementById('essay-options-group');

    mcqGroup.style.display = 'none';
    connectGroup.style.display = 'none';
    essayGroup.style.display = 'none';

    if (type.includes('متعدد')) {
        mcqGroup.style.display = 'block';
    } else if (type.includes('صل') || type.includes('قائمتين')) {
        connectGroup.style.display = 'block';
        clearCreationPairs();
    } else if (type.includes('مقالي')) {
        essayGroup.style.display = 'block';
        ExamManager.clearEssayBranches();
        renderEssayBranchesList();
    }
}

function handleEditTypeChange() {
    const type = document.getElementById('edit-question-type').value.trim();
    const mcqGroup = document.getElementById('edit-mcq-options-group');
    const connectGroup = document.getElementById('edit-connect-options-group');

    mcqGroup.style.display = 'none';
    connectGroup.style.display = 'none';

    if (type.includes('متعدد')) {
        mcqGroup.style.display = 'block';
    } else if (type.includes('صل') || type.includes('قائمتين')) {
        connectGroup.style.display = 'block';
    }
    // Note: detailed edit support for essay branches layout in modal is complex, 
    // for now we focus on creating them correctly.
}

// ============================================================================
// Essay Branches Handling
// ============================================================================
function addEssayBranch() {
    ExamManager.addEssayBranch('');
    renderEssayBranchesList();
}

function renderEssayBranchesList() {
    const list = document.getElementById('essay-branches-list');
    const branches = ExamManager.getEssayBranches();

    // Labels generator: a, b, c, d... localized
    const getLabel = (i) => {
        const isLTR = document.getElementById('ltr-mode-checkbox')?.checked;
        if (isLTR) return String.fromCharCode(97 + i) + ')';
        const arLabels = ['أ)', 'ب)', 'ج)', 'د)', 'هـ)', 'و)', 'ز)', 'ح)'];
        return arLabels[i] || (i + 1) + ')';
    };

    list.innerHTML = '';

    branches.forEach((branch, index) => {
        const row = document.createElement('div');
        row.className = 'essay-branch-row';
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.alignItems = 'center';

        row.innerHTML = `
            <span style="font-weight: bold; min-width: 25px;">${getLabel(index)}</span>
            <input type="text" class="essay-branch-input" value="${escapeHtml(branch.text)}" 
                placeholder="نص الفرع..." style="flex: 1;" onchange="updateEssayBranch(${index}, this.value)">
            ${branches.length > 2 ? `<button type="button" class="q-action-btn delete" onclick="deleteEssayBranch(${index})" title="حذف"><i class="fas fa-trash"></i></button>` : ''}
        `;
        list.appendChild(row);
    });
}

function updateEssayBranch(index, value) {
    ExamManager.updateEssayBranch(index, value);
}

function deleteEssayBranch(index) {
    ExamManager.deleteEssayBranch(index);
    renderEssayBranchesList();
}

// ============================================================================
// Creation Pairs (Connect Questions)
// ============================================================================
function addPairToCreation() {
    const colA = document.getElementById('connect-col-a').value.trim();
    const colB = document.getElementById('connect-col-b').value.trim();
    if (!colA && !colB) {
        customAlert('بيانات ناقصة', 'يرجى إدخال قيمة واحدة على الأقل', 'fa-exclamation-circle');
        return;
    }
    ExamManager.addCreationPair(colA, colB);
    renderCreationPairsList();
    document.getElementById('connect-col-a').value = '';
    document.getElementById('connect-col-b').value = '';
}

function renderCreationPairsList() {
    const list = document.getElementById('connect-pairs-list');
    const warning = document.getElementById('creation-matching-warning');
    const addBtn = document.getElementById('add-pair-btn');
    const pairs = ExamManager.getCreationPairs();

    // Use DocumentFragment for efficient DOM manipulation
    const fragment = document.createDocumentFragment();

    if (pairs.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-pairs-msg';
        emptyMsg.textContent = 'لا توجد أزواج بعد';
        fragment.appendChild(emptyMsg);
        if (warning) warning.style.display = 'inline';
        if (addBtn) addBtn.style.boxShadow = '0 0 8px rgba(220, 53, 69, 0.5)';
    } else {
        if (warning) warning.style.display = 'none';
        if (addBtn) addBtn.style.boxShadow = 'none';

        pairs.forEach((pair, index) => {
            const row = document.createElement('div');
            row.className = 'creation-pair-row';
            row.innerHTML = `
                <input type="text" class="pair-input-a" value="${escapeHtml(pair.a)}" placeholder="يمين" onchange="updateCreationPair(${index}, 'a', this.value)">
                <input type="text" class="pair-input-b" value="${escapeHtml(pair.b)}" placeholder="يسار" onchange="updateCreationPair(${index}, 'b', this.value)">
                <button type="button" class="q-action-btn delete" onclick="deleteCreationPair(${index})" title="حذف"><i class="fas fa-trash"></i></button>
            `;
            fragment.appendChild(row);
        });
    }

    list.innerHTML = '';
    list.appendChild(fragment);
}

function updateCreationPair(index, field, value) {
    ExamManager.updateCreationPair(index, field, value);
}

function deleteCreationPair(index) {
    ExamManager.deleteCreationPair(index);
    renderCreationPairsList();
}

function clearCreationPairs() {
    ExamManager.clearCreationPairs();
    renderCreationPairsList();
}

// ============================================================================
// Image Compression
// ============================================================================
async function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve) => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        img.onload = () => {
            let { width, height } = img;
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(img.src);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };

        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            resolve(null);
        };

        img.src = URL.createObjectURL(file);
    });
}

async function handleImageUpload(file) {
    if (!file) return null;
    const MAX_SIZE = 500 * 1024; // 500KB
    if (file.size > MAX_SIZE) {
        return await compressImage(file);
    }
    return await readFileAsDataURL(file);
}

function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error('Failed to read file'));
        r.readAsDataURL(file);
    });
}

// ============================================================================
// Add Question
// ============================================================================
async function addQuestion() {
    const text = document.getElementById('question-text').value;
    const type = document.getElementById('question-type').value.trim();
    const mark = document.getElementById('question-mark').value;
    const space = parseInt(document.getElementById('question-space').value) || 0;
    const isDotted = document.getElementById('question-space-dotted').checked;

    let imageSrc = null;
    const imageInput = document.getElementById('question-image');
    if (imageInput && imageInput.files && imageInput.files[0]) {
        try {
            imageSrc = await handleImageUpload(imageInput.files[0]);
        } catch (e) {
            console.error(e);
            customAlert('خطأ في الصورة', 'حدث خطأ أثناء تحميل الصورة', 'fa-exclamation-triangle');
            return;
        }
    }

    // Connect questions
    if (type.includes('صل') || type.includes('قائمتين')) {
        const pairs = ExamManager.getCreationPairs();
        if (pairs.length === 0 && !text) {
            customAlert('بيانات ناقصة', 'يرجى إضافة زوج واحد على الأقل أو كتابة نص السؤال', 'fa-exclamation-circle');
            return;
        }
        const newQ = {
            type,
            text: text || 'صل بين القائمتين:',
            mark,
            space,
            isDotted,
            image: imageSrc,
            pairs: [...pairs]
        };
        ExamManager.addQuestion(newQ);
        document.getElementById('question-text').value = '';
        document.getElementById('question-mark').value = '';
        document.getElementById('question-space').value = '0';
        document.getElementById('question-space-dotted').checked = true;
        if (imageInput) imageInput.value = '';
        clearCreationPairs();
        return;
    }

    // Essay questions
    if (type.includes('مقالي')) {
        const branches = ExamManager.getEssayBranches();
        const paragraph = document.getElementById('essay-paragraph').value;

        // Filter empty branches if there are many, but keep structure
        const validBranches = branches.filter(b => b.text.trim() !== '');

        if (validBranches.length === 0 && !text && !paragraph) {
            customAlert('بيانات ناقصة', 'يرجى كتابة نص السؤال أو إضافة أفرع', 'fa-exclamation-circle');
            return;
        }

        const newQ = {
            type,
            text: text || 'السؤال:',
            paragraph: paragraph,
            mark,
            space,
            isDotted,
            image: imageSrc,
            branches: validBranches.map(b => b.text)
        };
        ExamManager.addQuestion(newQ);

        // Reset form
        document.getElementById('question-text').value = '';
        document.getElementById('question-mark').value = '';
        document.getElementById('question-space').value = '0';
        document.getElementById('essay-paragraph').value = '';
        ExamManager.clearEssayBranches();
        renderEssayBranchesList();
        if (imageInput) imageInput.value = '';
        return;
    }

    if (!text) {
        customAlert('بيانات ناقصة', 'يرجى كتابة نص السؤال', 'fa-exclamation-circle');
        return;
    }

    const newQ = { type, text, mark, space, isDotted, image: imageSrc, options: {} };

    // MCQ questions
    if (type.includes('متعد')) {
        newQ.options = {
            a: document.getElementById('mcq-option-a').value || '...........',
            b: document.getElementById('mcq-option-b').value || '...........',
            c: document.getElementById('mcq-option-c').value || '...........',
            d: document.getElementById('mcq-option-d').value || '...........'
        };
        document.getElementById('mcq-option-a').value = '';
        document.getElementById('mcq-option-b').value = '';
        document.getElementById('mcq-option-c').value = '';
        document.getElementById('mcq-option-d').value = '';
    }

    ExamManager.addQuestion(newQ);
    document.getElementById('question-text').value = '';
    document.getElementById('question-mark').value = '';
    document.getElementById('question-space').value = '0';
    if (imageInput) imageInput.value = '';
}

function deleteQuestion(index) {
    ExamManager.deleteQuestion(index);
}

// ============================================================================
// Rendering Functions
// ============================================================================

function renderQuestionList() {
    const list = document.getElementById('added-questions-list');
    const questions = ExamManager.getQuestions();

    // Use DocumentFragment for batch DOM operation
    const fragment = document.createDocumentFragment();

    if (questions.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-questions-msg';
        emptyDiv.textContent = 'لم يتم إضافة أسئلة بعد';
        fragment.appendChild(emptyDiv);
    } else {
        questions.forEach((q, idx) => {
            const item = document.createElement('div');
            item.className = 'added-question-item';
            let badge = q.type.includes('متعدد')
                ? '<span class="badge badge-mcq">اختر</span>'
                : (q.type.includes('مقالي')
                    ? '<span class="badge badge-essay">مقالي</span>'
                    : '<span class="badge badge-other">أخرى</span>');
            item.innerHTML = `
                <div class="question-item-content">
                    <span class="question-number">#${idx + 1}</span>
                    ${badge}
                    <div class="added-question-text">${formatText(q.text)}</div>
                </div>
                <div class="question-actions-btn">
                    <button class="q-action-btn edit" onclick="editQuestion(${idx})"><i class="fas fa-edit"></i></button>
                    <button class="q-action-btn delete" onclick="deleteQuestion(${idx})"><i class="fas fa-trash"></i></button>
                </div>
            `;
            fragment.appendChild(item);
        });
    }

    list.innerHTML = '';
    list.appendChild(fragment);
}

async function renderExamPaper() {
    // Safety: ensure browser has completed layout before measurements
    await new Promise(r => setTimeout(r, 10));

    ExamManager.state.meta.mcqCount = 0;
    ExamManager.state.meta.questionCounter = 0;

    const papers = document.querySelectorAll('.paper');
    for (let i = 1; i < papers.length; i++) papers[i].remove();
    papers[0].querySelector('.paper-content').innerHTML = '';
    document.getElementById('answer-key-container').innerHTML = '';

    for (const q of ExamManager.getQuestions()) {
        await appendQuestionToDOM(q);
    }

    if (document.getElementById('answer-key-checkbox').checked) {
        toggleAnswerTable(); // Use the actual function name
    }

    const isLTR = document.getElementById('ltr-mode-checkbox').checked;
    updateHeaderLabels(isLTR);

    // Trim pages to remove large gaps when content overflows
    trimPages();

    // Update mobile preview simulation
    updateMobilePreview();
}

function updateMobilePreview() {
    const previewContent = document.getElementById('preview-window-content');
    if (!previewContent) return;

    // Only update if visible (on mobile)
    if (window.innerWidth > 1024) return;

    previewContent.innerHTML = '';

    const paper = document.querySelector('.paper');
    if (paper) {
        const clone = paper.cloneNode(true);
        // Remove IDs to avoid duplicates
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));

        const wrapper = document.createElement('div');
        wrapper.className = 'preview-paper-wrapper';
        // Add pointer-events: none to prevent interaction
        wrapper.style.pointerEvents = 'none';

        wrapper.appendChild(clone);
        previewContent.appendChild(wrapper);
    }
}

// ============================================================================
// Text Formatting with DOMPurify Sanitization
// ============================================================================
function formatText(text) {
    if (!text) return '';

    // Sanitize input - use DOMPurify if available, else basic escape
    let safe;
    if (typeof DOMPurify !== 'undefined') {
        safe = DOMPurify.sanitize(text.toString(), { ALLOWED_TAGS: [] });
    } else {
        safe = escapeHtml(text.toString());
    }

    return safe
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__ (.*?) __/g, '<u style="text-decoration: underline; text-underline-offset: 3px;">&nbsp;$1&nbsp;</u>')
        .replace(/__(.*?)__/g, '<u>$1</u>')
        .replace(/_(.*?)_/g, '<em>$1</em>');
}

function escapeHtml(t) {
    return t ? t.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;") : '';
}

// ============================================================================
// Page Creation & Overflow Checking (Synchronous)
// ============================================================================
function getActiveQuestionsContainer() {
    const conts = document.querySelectorAll('.paper-content');
    return conts[conts.length - 1];
}

// ============================================================================
// Page Creation & Overflow Checking (Synchronous)
// ============================================================================
function createNewPage() {
    const pc = document.getElementById('exam-paper');

    const p = document.createElement('div');
    p.className = 'paper';
    p.innerHTML = `<div class="paper-content" style="margin-top: 50px;"></div>`;

    pc.appendChild(p);
    return p.querySelector('.paper-content');
}

/**
 * Trims non-last paper pages so they don't keep the full A4 min-height
 * when content has been moved to subsequent pages. This eliminates the
 * large visual gap between pages.
 */
function trimPages() {
    const papers = document.querySelectorAll('.paper');
    if (papers.length <= 1) {
        // Only one page, keep full A4 height
        papers.forEach(p => p.classList.remove('trimmed'));
        return;
    }

    // Trim all pages except the last one to fit their actual content
    for (let i = 0; i < papers.length - 1; i++) {
        const paper = papers[i];
        const content = paper.querySelector('.paper-content');
        if (!content) continue;

        // Calculate actual content height
        const children = content.children;
        if (children.length === 0) {
            // Empty page — shouldn't happen, but handle gracefully
            paper.classList.add('trimmed');
            paper.style.minHeight = 'auto';
            continue;
        }

        // Find the bottom-most child position (relative to .paper, since .paper has position: relative)
        let maxBottom = 0;
        for (const child of children) {
            const bottom = child.offsetTop + child.offsetHeight;
            if (bottom > maxBottom) maxBottom = bottom;
        }

        // maxBottom is already measured from the top of .paper (includes header + content offset)
        // Just add bottom padding/breathing room
        const totalHeight = maxBottom + 80; // 80px bottom padding

        // A4 height in px at 96dpi ≈ 1123px. Only trim if content is significantly shorter.
        const fullA4Height = 1123;
        if (totalHeight < fullA4Height - 40) {
            paper.classList.add('trimmed');
            paper.style.minHeight = totalHeight + 'px';
        } else {
            paper.classList.remove('trimmed');
            paper.style.minHeight = '';
        }
    }

    // Last page always keeps full A4 height
    const lastPaper = papers[papers.length - 1];
    lastPaper.classList.remove('trimmed');
    lastPaper.style.minHeight = '';
}

function checkOverflow(el, depth = 0) {
    if (depth > 5 || !el || !el.closest('.paper')) return;

    // A4 content limit: 297mm - 18mm bottom padding = 279mm ≈ 1053px at 96dpi
    // Using 1050 as a safe threshold with small margin
    const maxHeight = 1050;

    // Force layout recalculation
    el.offsetHeight;
    const h = el.offsetTop + el.offsetHeight;

    if (h > maxHeight) {
        const cont = createNewPage();

        if (el.classList.contains('mcq-subquestion')) {
            const sec = document.createElement('div');
            sec.className = 'question-item mcq-section continuation';
            sec.innerHTML = `<div class="mcq-subquestions-cont"></div>`;
            cont.appendChild(sec);
            sec.querySelector('.mcq-subquestions-cont').appendChild(el);
        } else if (el.classList.contains('connect-pair-row')) {
            const sec = document.createElement('div');
            sec.className = 'question-item connect-section continuation';
            sec.innerHTML = `<div class="connect-pairs-cont"></div>`;
            cont.appendChild(sec);
            sec.querySelector('.connect-pairs-cont').appendChild(el);
        } else {
            cont.appendChild(el);
        }

        // Recursive check
        checkOverflow(el, depth + 1);
    }
}

// ============================================================================
// Append Question to DOM
// ============================================================================
async function appendQuestionToDOM(q) {
    let container = getActiveQuestionsContainer();
    const syncMath = async (targetEl = null) => {
        if (window.MathJax && window.MathJax.typesetPromise) {
            await window.MathJax.typesetPromise(targetEl ? [targetEl] : null);
        }
    };

    const isLTR = document.getElementById('ltr-mode-checkbox').checked;

    // MCQ Questions
    if (q.type.includes('متعدد')) {
        ExamManager.state.meta.mcqCount++;
        let section = container.querySelector('.mcq-section:last-of-type');

        if (!section) {
            ExamManager.state.meta.questionCounter++;
            section = document.createElement('div');
            section.className = 'question-item mcq-section';
            section.innerHTML = `
                <div class="question-header">
                    <strong>${isLTR ? `Question (${ExamManager.state.meta.questionCounter}):` : `السؤال رقم (${ExamManager.state.meta.questionCounter}):`}</strong>
                    ${q.mark ? `<span class="question-mark">(${q.mark} ${isLTR ? 'Marks' : 'علامات'})</span>` : ''}
                </div>
                <p class="question-instruction">${isLTR ? 'Choose correct answer:' : 'اختر رمز الإجابة الصحيح:'}</p>
                <div class="mcq-answer-table-container"></div>
                <div class="mcq-subquestions-cont"></div>
            `;
            container.appendChild(section);
            await syncMath(section);
            checkOverflow(section);
        }

        container = getActiveQuestionsContainer();
        section = container.querySelector('.mcq-section:last-of-type');
        const subqCont = section.querySelector('.mcq-subquestions-cont');
        const subQ = document.createElement('div');
        subQ.className = 'mcq-subquestion';
        // Localized labels
        const labels = isLTR
            ? { a: 'A)', b: 'B)', c: 'C)', d: 'D)' }
            : { a: 'أ)', b: 'ب)', c: 'ج)', d: 'د)' };
        subQ.innerHTML = `
            <div class="mcq-subq-header">${ExamManager.state.meta.mcqCount}: ${formatText(q.text)}</div>
            ${q.image ? `<img src="${q.image}" class="question-image" alt="Question image">` : ''}
            <div class="mcq-options">
                <div class="mcq-option-box"><span class="option-label">${labels.a}</span><span class="option-text">${formatText(q.options.a)}</span></div>
                <div class="mcq-option-box"><span class="option-label">${labels.b}</span><span class="option-text">${formatText(q.options.b)}</span></div>
                <div class="mcq-option-box"><span class="option-label">${labels.c}</span><span class="option-text">${formatText(q.options.c)}</span></div>
                <div class="mcq-option-box"><span class="option-label">${labels.d}</span><span class="option-text">${formatText(q.options.d)}</span></div>
            </div>
        `;
        subqCont.appendChild(subQ);

        // Check for overflow and switch to vertical layout if needed - SYNCHRONOUS
        // Uses browser-native overflow detection instead of manual width math
        const mcqOptions = subQ.querySelector('.mcq-options');
        if (mcqOptions) {
            // Force layout recalculation
            mcqOptions.offsetHeight;

            // The definitive overflow check: if the content is wider than the container,
            // scrollWidth will exceed clientWidth. This respects the actual paper borders.
            if (mcqOptions.scrollWidth > mcqOptions.clientWidth + 2) { // 2px tolerance
                mcqOptions.classList.add('vertical-layout');
                // Force another reflow after applying vertical layout
                mcqOptions.offsetHeight;
            }
        }

        if (document.getElementById('answer-key-checkbox').checked) {
            toggleAnswerTable(container);
        }
        await syncMath(subQ);
        // Now check overflow AFTER vertical layout has been applied
        checkOverflow(subQ);
        return;
    }

    ExamManager.state.meta.questionCounter++;

    // Connect Questions
    if ((q.type.includes('صل') || q.type.includes('قائمتين')) && q.pairs) {
        let section = document.createElement('div');
        section.className = 'question-item connect-section';
        section.innerHTML = `
            <div class="question-header">
                <strong>${isLTR ? `Question (${ExamManager.state.meta.questionCounter}):` : `السؤال رقم (${ExamManager.state.meta.questionCounter}):`}</strong>
                ${q.mark ? `<span class="question-mark">(${q.mark} ${isLTR ? 'Marks' : 'علامات'})</span>` : ''}
            </div>
            <p class="question-text-body">${formatText(q.text)}</p>
            ${q.image ? `<img src="${q.image}" class="question-image" alt="Question image">` : ''}
            <div class="connect-pairs-cont" style="${isLTR ? 'direction: ltr;' : 'direction: rtl;'}"></div>
        `;
        container.appendChild(section);
        await syncMath(section);
        checkOverflow(section);

        container = getActiveQuestionsContainer();
        section = container.querySelector('.connect-section:last-of-type');
        const pairsCont = section.querySelector('.connect-pairs-cont');

        for (const p of q.pairs) {
            const row = document.createElement('div');
            row.className = 'connect-pair-row';
            row.innerHTML = `
                <div class="connect-box">${escapeHtml(p.a)}</div>
                <div class="connect-box">${escapeHtml(p.b)}</div>
            `;
            pairsCont.appendChild(row);
            await syncMath(row);
            checkOverflow(row);
        }
        return;
    }

    // Essay / Other Questions with Branches support
    const qDiv = document.createElement('div');
    qDiv.className = 'question-item';

    // Header format: Question (X)
    let headerHtml = `
        <div class="question-header">
            <strong>${isLTR ? `Question (${ExamManager.state.meta.questionCounter}):` : `السؤال (${ExamManager.state.meta.questionCounter})`}</strong>
            <span style="font-weight: normal; ${isLTR ? 'margin-left' : 'margin-right'}: 10px; flex: 1;">${formatText(q.text)}</span>
            ${q.mark ? `<span class="question-mark">(${q.mark} ${isLTR ? 'Marks' : 'علامات'})</span>` : ''}
        </div>
    `;

    // Paragraph (if any)
    let bodyHtml = '';
    if (q.paragraph) {
        bodyHtml += `<p class="question-text-body question-paragraph" style="margin-top: 5px; margin-bottom: 10px;">${formatText(q.paragraph)}</p>`;
    } else if (q.type && !q.type.includes('مقالي')) {
        // For non-essay types that fall here (like fill blank), use text as body if not used in header?
        // Actually, for other types strict 'text' is usually the body. 
        // But with our new design, 'text' is in header.
        // Let's keep existing behavior for non-essay: text is main body.
        // BUT, we put text in header above. This might double render for old questions?
        // Wait, 'text' IS the question. "Define X".
        // "Question 1: Define X". This is fine.
    }

    // Image
    if (q.image) {
        bodyHtml += `<img src="${q.image}" class="question-image" alt="Question image">`;
    }

    // Branches
    if (q.branches && q.branches.length > 0) {
        bodyHtml += `<div class="question-branches" style="margin-top: 10px;">`;
        q.branches.forEach((branch, bIdx) => {
            const isLTR = ExamManager.state.settings.isLTR;
            const arLabels = ['أ)', 'ب)', 'ج)', 'د)', 'هـ)', 'و)', 'ز)', 'ح)'];
            const label = isLTR ? (String.fromCharCode(97 + bIdx) + ')') : (arLabels[bIdx] || (bIdx + 1) + ')');
            bodyHtml += `
                <div class="question-branch" style="display: flex; gap: 8px; margin-bottom: 6px; font-size: 1.1rem;">
                    <span style="font-weight: bold;">${label}</span>
                    <span>${formatText(branch)}</span>
                </div>
            `;
        });
        bodyHtml += `</div>`;
    }

    // If it's NOT essay and NO paragraph, we might want the text in body instead of header?
    // The user specifically asked for "السؤال" on same line as "سؤال رقم" for ESSAY.
    // For others, keep as is?
    // Let's strictly control this.

    if (!q.type.includes('مقالي')) {
        // Revert to standard behavior for non-essay to avoid breaking other types
        headerHtml = `
            <div class="question-header">
                <strong>${isLTR ? `Question (${ExamManager.state.meta.questionCounter}):` : `السؤال رقم (${ExamManager.state.meta.questionCounter}):`}</strong>
                ${q.mark ? `<span class="question-mark">(${q.mark} ${isLTR ? 'Marks' : 'علامات'})</span>` : ''}
            </div>
        `;
        bodyHtml = `<p class="question-text-body">${formatText(q.text)}</p>` + bodyHtml; // Image is already in bodyHtml
    }

    qDiv.innerHTML = headerHtml + bodyHtml;

    if (q.space > 0) {
        const sDiv = document.createElement('div');
        sDiv.className = 'empty-lines-space';
        let c = '';
        for (let i = 0; i < q.space; i++) {
            c += `<div class="answer-line ${q.isDotted ? 'dotted' : ''}"></div>`;
        }
        sDiv.innerHTML = c;
        qDiv.appendChild(sDiv);
    }

    container.appendChild(qDiv);
    await syncMath(qDiv);
    checkOverflow(qDiv);
}

// ============================================================================
// Edit Question
// ============================================================================
function editQuestion(index) {
    ExamManager.state.editing.currentIndex = index;
    const q = ExamManager.getQuestions()[index];

    document.getElementById('edit-question-text').value = q.text;
    document.getElementById('edit-question-type').value = q.type;
    document.getElementById('edit-question-mark').value = q.mark || '';
    document.getElementById('edit-question-space').value = q.space || 0;
    document.getElementById('edit-question-space-dotted').checked = q.isDotted !== false;

    document.getElementById('edit-mcq-options-group').style.display = q.type.includes('متعدد') ? 'block' : 'none';
    document.getElementById('edit-connect-options-group').style.display = (q.type.includes('صل') || q.type.includes('قائمتين')) ? 'block' : 'none';

    if (q.type.includes('متعدد')) {
        document.getElementById('edit-mcq-option-a').value = q.options.a || '';
        document.getElementById('edit-mcq-option-b').value = q.options.b || '';
        document.getElementById('edit-mcq-option-c').value = q.options.c || '';
        document.getElementById('edit-mcq-option-d').value = q.options.d || '';
    } else if (q.type.includes('صل')) {
        const list = document.getElementById('edit-connect-pairs-list');
        list.innerHTML = '';
        if (q.pairs) q.pairs.forEach(p => addPairRowToEditList(p.a, p.b));
    }

    showModal('edit-question-modal');
}

function addPairRowToEditList(a, b) {
    const list = document.getElementById('edit-connect-pairs-list');
    const row = document.createElement('div');
    row.className = 'edit-pair-row';
    row.innerHTML = `
        <input type="text" class="pair-input-a" value="${escapeHtml(a)}">
        <input type="text" class="pair-input-b" value="${escapeHtml(b)}">
        <button type="button" class="q-action-btn delete" onclick="this.parentElement.remove()"><i class="fas fa-trash"></i></button>
    `;
    list.appendChild(row);
}

function addPairInEdit() {
    const a = document.getElementById('edit-connect-new-a').value;
    const b = document.getElementById('edit-connect-new-b').value;
    if (a && b) {
        addPairRowToEditList(a, b);
        document.getElementById('edit-connect-new-a').value = '';
        document.getElementById('edit-connect-new-b').value = '';
    }
}

async function saveEditedQuestion() {
    const index = ExamManager.state.editing.currentIndex;
    if (index === -1) return;

    const text = document.getElementById('edit-question-text').value;
    const type = document.getElementById('edit-question-type').value;
    const mark = document.getElementById('edit-question-mark').value;
    const space = parseInt(document.getElementById('edit-question-space').value) || 0;
    const isDotted = document.getElementById('edit-question-space-dotted').checked;

    let img = ExamManager.getQuestions()[index].image;
    const input = document.getElementById('edit-question-image');
    if (input && input.files[0]) {
        try {
            img = await handleImageUpload(input.files[0]);
        } catch (e) {
            console.error(e);
        }
    }

    const updated = {
        ...ExamManager.getQuestions()[index],
        text,
        type,
        mark,
        space,
        isDotted,
        image: img,
        options: {},
        pairs: []
    };

    if (type.includes('متعدد')) {
        updated.options = {
            a: document.getElementById('edit-mcq-option-a').value,
            b: document.getElementById('edit-mcq-option-b').value,
            c: document.getElementById('edit-mcq-option-c').value,
            d: document.getElementById('edit-mcq-option-d').value
        };
    } else if (type.includes('صل')) {
        document.querySelectorAll('.edit-pair-row').forEach(r => {
            updated.pairs.push({
                a: r.querySelector('.pair-input-a').value,
                b: r.querySelector('.pair-input-b').value
            });
        });
    }

    ExamManager.updateQuestion(index, updated);
    hideModal('edit-question-modal');
}

function deleteEditingQuestion() {
    const index = ExamManager.state.editing.currentIndex;
    if (index === -1) return;
    customConfirm('حذف السؤال', 'هل أنت متأكد من حذف هذا السؤال؟', () => {
        ExamManager.deleteQuestion(index);
        hideModal('edit-question-modal');
    }, 'fa-trash');
}

// ============================================================================
// Answer Table
// ============================================================================
function toggleAnswerTable(sc = null) {
    const mcqCount = ExamManager.state.meta.mcqCount;
    const conts = sc ? [sc] : document.querySelectorAll('.paper-content');

    conts.forEach(c => {
        c.querySelectorAll('.mcq-section').forEach(s => {
            const table = s.querySelector('.mcq-answer-table-container');
            if (!table || !document.getElementById('answer-key-checkbox').checked || mcqCount === 0) {
                if (table) table.innerHTML = '';
                return;
            }

            let html = '<table class="answer-key-table"><tbody>';
            const rs = Math.ceil(mcqCount / 10);
            for (let r = 0; r < rs; r++) {
                const start = r * 10;
                const end = Math.min(start + 10, mcqCount);
                // const colsInRow = end - start; // This line is now effectively unused

                // Header row (Numbers)
                html += '<tr>';
                for (let i = 1; i <= 10; i++) {
                    let n = r * 10 + i;
                    html += `<th>${n <= mcqCount ? n : ''}</th>`;
                }
                html += '</tr>';

                // Content row (Empty boxes for answers)
                html += '<tr>';
                for (let i = 1; i <= 10; i++) {
                    html += '<td></td>';
                }
                html += '</tr>';
            }
            table.innerHTML = html + '</tbody></table>';
        });
    });
}


// ============================================================================
// Export Functions - Server-side PDF Generation Only
// ============================================================================
const PDF_SERVER_URL = 'https://us-central1-al-imtihan.cloudfunctions.net/generatePdf';

async function exportFile(format) {
    if (format !== 'pdf') return;
    if (!(await validateMarks())) return;

    // Client-side PDF Generation (Overhauled "Old System")
    if (format === 'pdf') {
        const loadingBtn = document.querySelector("button[onclick*=\"exportFile('pdf')\"]");
        const originalText = loadingBtn ? loadingBtn.innerHTML : '';
        if (loadingBtn) loadingBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإنشاء...';

        // 1. Inject Force-Desktop Styles (fixes Mobile Pagination logic)
        const style = document.createElement('style');
        style.id = 'print-override-style';
        style.innerHTML = `
            body.exporting-pdf #exam-paper {
                display: block !important;
                visibility: visible !important;
                width: 210mm !important;
                margin: 0 auto !important;
                position: relative !important;
                background: white !important;
                left: auto !important;
                opacity: 1 !important;
                overflow: visible !important;
            }
            body.exporting-pdf .paper {
                display: block !important;
                width: 210mm !important;
                min-height: 297mm !important;
                margin: 0 auto !important;
                box-shadow: none !important;
                position: relative !important;
            }
            body.exporting-pdf .paper.trimmed {
                min-height: auto !important;
            }
        `;
        document.head.appendChild(style);
        document.body.classList.add('exporting-pdf');

        // Reset scroll position to prevent shift during capture
        const paperContainer = document.getElementById('exam-paper');
        if (paperContainer) {
            paperContainer.scrollTop = 0;
            paperContainer.scrollLeft = 0;
        }
        window.scrollTo(0, 0);

        try {
            // 2. FORCE RE-RENDER (Crucial: Calculates overflow with 210mm width)
            // This splits the "One Giant Page" into proper A4 pages.
            await renderExamPaper();

            // Short delay to ensure DOM paint
            await new Promise(r => setTimeout(r, 500));

            // Filter out empty papers to prevent extra blank pages
            const allPapers = document.querySelectorAll('.paper');
            const papers = Array.from(allPapers).filter(p => {
                const content = p.querySelector('.paper-content');
                return content && (content.innerText.trim().length > 0 || content.querySelector('img') || content.querySelector('.question-container'));
            });

            if (papers.length === 0) throw new Error('لا توجد صفحات للتصدير');

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();

            loadingBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 0%';

            // Use lower scale for mobile to improve speed
            const isMobile = window.innerWidth < 768;
            const renderScale = isMobile ? 1.5 : 2;

            for (let i = 0; i < papers.length; i++) {
                const paper = papers[i];
                const percent = Math.round(((i) / papers.length) * 100);
                if (loadingBtn) loadingBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${percent}%`;

                // Scroll paper into view to ensure correct capture position
                paper.scrollIntoView({ block: 'start', behavior: 'instant' });
                await new Promise(r => setTimeout(r, 50));

                const isTrimmed = paper.classList.contains('trimmed');
                const canvas = await html2canvas(paper, {
                    scale: renderScale,
                    useCORS: true,
                    logging: false,
                    windowWidth: 1200,
                    scrollX: 0,
                    scrollY: -window.scrollY,
                    ignoreElements: (el) => el.classList.contains('page-controls') || el.classList.contains('active-question-overlay') || el.classList.contains('ad-sidebar') || el.classList.contains('ad-unit-box') || el.classList.contains('ad-header-inline')
                });

                const imgData = canvas.toDataURL('image/png');
                if (i > 0) pdf.addPage();

                if (isTrimmed) {
                    // For trimmed pages, scale image to fit width and use proportional height
                    const imgAspect = canvas.height / canvas.width;
                    const imgHeight = pdfWidth * imgAspect;
                    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
                } else {
                    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
                }

                // Memory Cleanup: Professional Optimization
                canvas.width = 0;
                canvas.height = 0;
                canvas.remove();
            }

            pdf.save(`Exam_${new Date().toISOString().slice(0, 10)}.pdf`);
            if (loadingBtn) loadingBtn.innerHTML = originalText;
            hideModal('custom-alert-modal');
            customAlert('تم بنجاح', 'تم تحميل ملف PDF.', 'fa-check-circle');

        } catch (error) {
            console.error('PDF Generation Error:', error);
            if (loadingBtn) loadingBtn.innerHTML = originalText;
            hideModal('custom-alert-modal');
            customAlert('خطأ في التصدير', 'حدث خطأ أثناء إنشاء PDF: ' + error.message, 'fa-exclamation-triangle');
        } finally {
            // Cleanup: Restore original view state
            document.body.classList.remove('exporting-pdf');
            if (style) style.remove();
        }
        return;
        // Old server logic removed for clean client-side switch
    }
}

// ============================================================================
// Community Exams (localStorage for now, Firebase integration coming)
// ============================================================================
let isLoadingExams = false;
async function loadCommunityExams() {
    if (isLoadingExams) return;
    isLoadingExams = true;

    const grid = document.getElementById('exams-grid');
    if (!grid) {
        isLoadingExams = false;
        return;
    }

    // Clear everything from grid
    grid.innerHTML = '<div id="loading-indicator" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-light);"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 10px;"></i><br>جاري الاتصال بقاعدة البيانات...</div>';

    const sf = document.getElementById('community-filter-subject').value;
    const gf = document.getElementById('community-filter-grade').value;
    const pf = document.getElementById('community-filter-period').value;
    const sef = document.getElementById('community-filter-semester').value;
    const cf = document.getElementById('community-filter-country').value;

    try {
        let exams = [];
        // Use ExamManager (Compat)
        if (ExamManager.db) {
            exams = await ExamManager.getCommunityExams({
                subject: sf,
                grade: gf,
                period: pf,
                semester: sef,
                country: cf,
                limit: 50
            });
        } else if (window.FirebaseService && FirebaseService.isEnabled()) {
            // Keep fallback just in case
            exams = await FirebaseService.getCommunityExams({
                subject: sf,
                grade: gf,
                period: pf,
                semester: sef,
                country: cf,
                limit: 50
            });
        } else {
            console.warn('Firebase not available, falling back to localStorage');
            exams = JSON.parse(localStorage.getItem('sharedExams') || '[]');
            if (sf) exams = exams.filter(ex => ex.header?.subject === sf);
            if (gf) exams = exams.filter(ex => ex.header?.grade === gf);
            if (pf) exams = exams.filter(ex => ex.header?.period === pf);
        }

        // Remove loading indicator
        grid.innerHTML = '';

        if (exams.length === 0) {
            checkEmptyState();
            isLoadingExams = false;
            return;
        }

        exams.forEach((ex, i) => {
            const card = document.createElement('div');
            card.className = 'exam-card community-card';
            card.onclick = () => viewCommunityExam(ex, i); // Pass full object

            const h = ex.header || {};
            const countryMap = {
                jordan: 'الأردن', saudi: 'السعودية', palestine: 'فلسطين', egypt: 'مصر',
                uae: 'الإمارات', bahrain: 'البحرين', algeria: 'الجزائر', iraq: 'العراق',
                yemen: 'اليمن', syria: 'سوريا', oman: 'عمان', qatar: 'قطر',
                kuwait: 'الكويت', lebanon: 'لبنان', libya: 'ليبيا'
            };
            const countryDisp = countryMap[h.country] || '';
            const subjDisp = SUBJECT_DATA[h.subject] ? SUBJECT_DATA[h.subject].ar : (h.subject || '');
            const periodMap = { month1: 'شهر 1', month2: 'شهر 2', final: 'نهائي', custom: 'مخصص' };
            const periodDisp = periodMap[h.period] || h.period || '';
            const semesterDisp = h.semester === '1' ? 'فصل 1' : (h.semester === '2' ? 'فصل 2' : '');

            card.innerHTML = `
                <div class="card-thumb"><i class="fas fa-file-alt"></i></div>
                <div class="card-content">
                    <h4>${escapeHtml(ex.title || 'بدون عنوان')}</h4>
                    <p>بواسطة: ${escapeHtml(ex.author || 'غير معروف')}</p>
                    <div class="community-badges-grid">
                        ${countryDisp ? `<span class="badge blue-light"><i class="fas fa-globe"></i> ${escapeHtml(countryDisp)}</span>` : ''}
                        ${subjDisp ? `<span class="badge blue-solid"><i class="fas fa-book"></i> ${escapeHtml(subjDisp)}</span>` : ''}
                        ${h.grade ? `<span class="badge blue-light"><i class="fas fa-graduation-cap"></i> ${escapeHtml(h.grade)}</span>` : ''}
                        ${periodDisp ? `<span class="badge blue-light"><i class="fas fa-calendar-check"></i> ${escapeHtml(periodDisp)}</span>` : ''}
                        ${semesterDisp ? `<span class="badge blue-light"><i class="fas fa-book-open"></i> ${escapeHtml(semesterDisp)}</span>` : ''}
                    </div>
                </div>
                ${ExamManager.state.isAdmin ? `<button class="delete-community-btn" onclick="confirmDeleteCommunityExam('${ex.id}', event)" title="حذف الامتحان"><i class="fas fa-times"></i></button>` : ''}
            `;
            grid.appendChild(card);
        });

        // Trigger dry check after populating
        checkEmptyState();
    } catch (e) {
        console.error('Error loading exams:', e);
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #dc3545;">فشل تحميل الامتحانات. يرجى المحاولة لاحقاً.</div>';
    } finally {
        checkEmptyState();
        isLoadingExams = false;
    }
}

async function viewCommunityExam(ex, idx) {
    if (!ex) return;

    customConfirm('استيراد امتحان', 'هل تريد استيراد هذا الامتحان؟ سيتم استبدال عملك الحالي.', () => {
        // Issue 2: Deep copy import
        ExamManager.state.questions = JSON.parse(JSON.stringify(ex.questions));
        ExamManager.restoreHeader(ex.header);
        skipDraftPrompt = true; // Don't show draft prompt when importing
        switchView('maker'); // Ensure visible before rendering
        ExamManager.requestRender();
    }, 'fa-file-import');
}

// Admin Moderation (Issue 10: Custom UI)
async function checkAdminAccess() {
    customPromptAdmin();
}

async function confirmDeleteCommunityExam(examId, event) {
    event.stopPropagation();
    if (!ExamManager.state.isAdmin) return;

    customConfirm('حذف الامتحان', 'هل أنت متأكد من حذف هذا الامتحان نهائياً من المجتمع؟', async () => {
        const res = await ExamManager.deleteExam(examId);
        if (res.success) {
            customAlert('تم الحذف', 'تم حذف الامتحان بنجاح.', 'fa-check-circle');
            loadCommunityExams();
        } else {
            customAlert('خطأ', 'فشل الحذف: ' + res.error, 'fa-exclamation-triangle');
        }
    }, 'fa-trash');
}


// Captcha for sharing
let captchaAnswer = 0;
function generateCaptcha() {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    captchaAnswer = a + b;
    document.getElementById('captcha-question').textContent = `${a} + ${b}`;
}

function openShareModal() {
    const teacher = document.getElementById('input-teacher').value;
    const shareUser = document.getElementById('share-username');
    if (shareUser && teacher) shareUser.value = teacher;
    showModal('export-share-modal');
}

async function handleShareSubmit(event) {
    event.preventDefault();

    const userAnswer = parseInt(document.getElementById('captcha-answer').value);
    const errorEl = document.getElementById('captcha-error');

    if (userAnswer !== captchaAnswer) {
        errorEl.style.display = 'block';
        generateCaptcha();
        return;
    }

    errorEl.style.display = 'none';

    // Validate Main UI Input Fields specific for sharing
    const subject = document.getElementById('input-subject').value;
    const grade = document.getElementById('input-grade').value;

    if (!subject || !grade) {
        customAlert('بيانات ناقصة', 'يرجى اختيار المادة والصف من لوحة التحكم قبل المشاركة.', 'fa-exclamation-circle');
        hideModal('export-share-modal');
        return;
    }

    // Validate Questions exist
    const questions = ExamManager.getQuestions();
    if (questions.length === 0) {
        customAlert('لا يوجد أسئلة', 'لا يمكن مشاركة اختبار فارغ. يرجى إضافة أسئلة أولاً.', 'fa-exclamation-triangle');
        hideModal('export-share-modal');
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري المشاركة...';

    const semester = document.getElementById('input-semester').value;
    const period = document.getElementById('input-period').value;
    // const subject = ... (already got it)
    // const grade = ... (already got it)

    const periodText = period === 'month1' ? 'الشهر الأول' : (period === 'month2' ? 'الشهر الثاني' : 'النهائي');
    const semesterText = semester === '1' ? 'الفصل الأول' : 'الفصل الثاني';
    const subjDisp = SUBJECT_DATA[subject] ? SUBJECT_DATA[subject].ar : subject;
    const autoTitle = `${subjDisp} - ${periodText} - ${semesterText}`;

    // Priority: Fetch all metadata from UI inputs directly
    const headerData = ExamManager.getHeaderData();
    const author = document.getElementById('share-username').value;

    // User Request: Fetch from UI EXCEPT the teacher name (which comes from share modal)
    // Actually, we'll keep the header teacher as is from the UI, 
    // but the shared exam's meta author will be the share modal value.
    // If they want the header teacher to change TOO, we'd overwrite it.
    // Let's assume they want the share author to be separate from the teacher name.

    const examData = {
        title: headerData.title || autoTitle, // Use UI title if exists, else auto
        author: author,
        header: headerData,
        questions: ExamManager.getQuestions()
    };

    try {
        let res;
        // Use ExamManager (Compat) if available
        if (ExamManager.db) {
            res = await ExamManager.shareExam(examData);
        } else if (window.FirebaseService && FirebaseService.isEnabled()) {
            // Fallback to Module Service if Compat failed but Module worked (unlikely)
            res = await FirebaseService.shareExam(examData);
        } else {
            console.warn('Firebase not available, using localStorage');
            res = { success: true };
            const existing = JSON.parse(localStorage.getItem('sharedExams') || '[]');
            examData.id = 'local_' + Date.now();
            examData.createdAt = new Date().toISOString();
            existing.unshift(examData);
            localStorage.setItem('sharedExams', JSON.stringify(existing));
        }

        if (res.success) {
            customAlert('تمت المشاركة', 'تم مشاركة الاختبار بنجاح مع المجتمع!', 'fa-check-circle');
            hideModal('export-share-modal');
            loadCommunityExams();
        } else {
            // Distinguish permission errors
            const errMsg = res.error?.includes('permission')
                ? 'عذراً، يرجى ملء كافة الحقول الأساسية (المادة، الصف، العنوان) والمحاولة مرة أخرى.'
                : res.error;
            customAlert('فشل المشاركة', errMsg, 'fa-exclamation-triangle');
        }
    } catch (e) {
        console.error('Share error:', e);
        customAlert('خطأ غير متوقع', 'حدث خطأ أثناء معالجة الطلب.', 'fa-exclamation-triangle');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
    }
}

// ============================================================================
// LTR Mode & Title Generation
// ============================================================================
function toggleLTRMode() {
    const ltr = document.getElementById('ltr-mode-checkbox').checked;
    ExamManager.state.settings.isLTR = ltr;
    document.getElementById('exam-paper').classList.toggle('ltr-mode', ltr);
    updateHeaderLabels(ltr);
    ExamManager.requestRender();
}

function updateHeaderLabels(ltr) {
    const lb = {
        'label-subject': ['المادة:', 'Subject:'],
        'label-grade': ['الصف:', 'Grade:'],
        'label-date': ['التاريخ:', 'Date:'],
        'label-time': ['الزمن:', 'Time:'],
        'label-teacher': ['المعلم:', 'Teacher:'],
        'label-score': ['العلامة:', 'Marks:'],
        'header-bism': ['بسم الله الرحمن الرحيم', 'In the name of Allah, the Most Gracious, the Most Merciful'],
        'paper-ministry': ['وزارة التربية والتعليم', 'Ministry of Education'],
        'label-student-name': ['الاسم: ......................................................', 'Name: ......................................................'],
        'label-student-section': ['الشعبة: ....................', 'Section: ....................']
    };
    for (const [id, [ar, en]] of Object.entries(lb)) {
        const el = document.getElementById(id);
        if (el) el.textContent = ltr ? en : ar;
    }

    // Also sync dynamic values
    syncHeader();
}

function syncHeader() {
    const h = ExamManager.getHeaderData(); // Reads inputs
    const isLTR = document.getElementById('ltr-mode-checkbox').checked;

    // Direct mapping for text inputs
    document.getElementById('paper-directorate').textContent = h.directorate || 'مديرية التربية والتعليم ...';
    document.getElementById('paper-school').textContent = h.school || 'مدرسة ...';
    document.getElementById('paper-date').textContent = h.date || '- -';
    document.getElementById('paper-time').textContent = h.time || '...';
    document.getElementById('paper-teacher').textContent = h.teacher || '...';
    document.getElementById('paper-title').textContent = h.title || '...';
    document.getElementById('paper-score').textContent = h.score || '...';

    // Translated Value: Subject
    const subjKey = h.subject;
    if (subjKey && SUBJECT_DATA[subjKey]) {
        document.getElementById('paper-subject').textContent = isLTR ? SUBJECT_DATA[subjKey].en : SUBJECT_DATA[subjKey].ar;
    } else {
        document.getElementById('paper-subject').textContent = subjKey || '.......';
    }

    // Translated Value: Grade
    const gradeKey = h.grade;
    const gradeObj = GRADE_DATA.find(g => g.val === gradeKey);
    if (gradeObj) {
        document.getElementById('paper-grade').textContent = isLTR ? gradeObj.en : gradeObj.ar;
    } else {
        document.getElementById('paper-grade').textContent = gradeKey || '.......';
    }
}

async function validateMarks() {
    return new Promise((resolve) => {
        const totalInput = parseInt(document.getElementById('input-score').value) || 0;
        const questions = ExamManager.getQuestions();
        let sum = 0;
        questions.forEach(q => { sum += (parseInt(q.mark) || 0); });

        if (sum !== totalInput) {
            customConfirm('تنبيه العلامات', `تحذير: مجموع علامات الأسئلة (${sum}) لا يساوي العلامة الكلية (${totalInput}). هل تريد المتابعة؟`,
                () => resolve(true), 'fa-exclamation-triangle', () => resolve(false));
        } else {
            resolve(true);
        }
    });
}

function generateTitle() {
    const s = document.getElementById('input-semester').value;
    const p = document.getElementById('input-period').value;
    const l = document.getElementById('ltr-mode-checkbox').checked;

    if (p === 'custom') return;

    let t = l
        ? (p === 'month1' ? 'First Month' : (p === 'month2' ? 'Second Month' : 'Final')) + ' - ' + (s === '1' ? 'First Sem' : 'Second Sem')
        : (p === 'month1' ? 'اختبار الشهر الأول' : (p === 'month2' ? 'اختبار الشهر الثاني' : 'الاختبار النهائي')) + ' - ' + (s === '1' ? 'الفصل الأول' : 'الفصل الثاني');

    document.getElementById('input-title').value = t;
    syncHeader();
}

// ============================================================================
// Dropdown Population
// ============================================================================
const SUBJECT_DATA = {
    'Maths': { ar: 'الرياضيات', en: 'Mathematics' },
    'Arabic': { ar: 'اللغة العربية', en: 'Arabic Language' },
    'English': { ar: 'اللغة الإنجليزية', en: 'English Language' },
    'Science': { ar: 'العلوم', en: 'General Science' },
    'Physics': { ar: 'الفيزياء', en: 'Physics' },
    'Chemistry': { ar: 'الكيمياء', en: 'Chemistry' },
    'Biology': { ar: 'الأحياء', en: 'Biology' },
    'Geology': { ar: 'علوم الأرض', en: 'Earth Science' },
    'History': { ar: 'التاريخ', en: 'History' },
    'Geography': { ar: 'الجغرافيا', en: 'Geography' },
    'Islamic': { ar: 'التربية الإسلامية', en: 'Islamic Education' },
    'Computer': { ar: 'الحاسوب', en: 'Computer Science' },
    'Civics': { ar: 'التربية الوطنية', en: 'Civics' },
    'Financial': { ar: 'الثقافة المالية', en: 'Financial Lit.' },
    'Vocational': { ar: 'التربية المهنية', en: 'Vocational Ed.' },
    'Philosophy': { ar: 'فلسفة', en: 'Philosophy' },
    'Psychology': { ar: 'علوم النفس والاجتماع', en: 'Psychology & Sociology' },
    'Sports': { ar: 'التربية الرياضية', en: 'Physical Education' }
};

const GRADE_DATA = Array.from({ length: 12 }, (_, i) => ({
    val: `Grade ${i + 1}`,
    ar: `الصف ${i + 1}`,
    en: `Grade ${i + 1}`
}));

function populateDropdowns() {
    ['input-subject', 'input-grade', 'community-filter-subject', 'community-filter-grade'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        el.innerHTML = '';

        // Add default option
        const def = document.createElement('option');
        def.value = '';
        if (id.includes('subject')) def.textContent = '(اختر المادة)';
        else def.textContent = '(اختر الصف)';
        el.appendChild(def);

        if (id.includes('subject')) {
            for (const [key, data] of Object.entries(SUBJECT_DATA)) {
                const opt = document.createElement('option');
                opt.value = key; // Keep English key for logic
                opt.textContent = data.ar; // Show Arabic in UI
                el.appendChild(opt);
            }
        } else {
            GRADE_DATA.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.val;
                opt.textContent = g.ar;
                el.appendChild(opt);
            });
        }
    });
}

// ============================================================================
// Initialization
// ============================================================================
// ============================================================================
// Auto-Update Mechanism (Issue: No hard refresh needed)
// ============================================================================
const CURRENT_VERSION = '2.32';
function checkForUpdates() {
    fetch('version.json?t=' + Date.now())
        .then(res => res.json())
        .then(data => {
            if (data.version && data.version !== CURRENT_VERSION) {
                console.log('Update found:', data.version, 'Reloading...');
                window.location.reload(true);
            }
        })
        .catch(() => { /* Silent fail */ });
}

document.addEventListener('DOMContentLoaded', () => {
    ExamManager.initFirebase(); // Initialize Firebase

    // Check for updates every 2 minutes
    setInterval(checkForUpdates, 120000);
    // Also check once on load (with a small delay to not block init)
    setTimeout(checkForUpdates, 5000);

    populateDropdowns();

    if (document.getElementById('question-type')) {
        const qt = document.getElementById('question-type');
        qt.addEventListener('change', handleQuestionTypeChange);
        // Force update on load if we have a default/saved type
        setTimeout(() => qt.dispatchEvent(new Event('change')), 100);
    }

    generateTitle();
    generateCaptcha();

    // Initialize ads in the hero section (visible on load)
    initAdUnits(document.getElementById('hero'));

    // Draft loading is now handled in switchView('maker')
});
