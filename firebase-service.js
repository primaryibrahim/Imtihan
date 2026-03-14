/**
 * Firebase Service Module for Imtihanati
 * Handles all Firebase operations for community exam sharing
 * 
 * SETUP INSTRUCTIONS:
 * 1. Install Firebase CLI: npm install -g firebase-tools
 * 2. Login to Firebase: firebase login
 * 3. Initialize project: firebase init (select Hosting and Firestore)
 * 4. Replace the firebaseConfig below with your project's config
 * 5. Deploy: firebase deploy
 */

// Firebase SDK imports (using ES modules via CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    doc,
    getDoc,
    deleteDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// ============================================================================
// Firebase Configuration
// ============================================================================
// TODO: Replace with your Firebase project configuration
// Go to Firebase Console > Project Settings > Your Apps > Web app
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Check if Firebase is configured
const isFirebaseConfigured = () => {
    return firebaseConfig.apiKey !== "YOUR_API_KEY";
};

// Initialize Firebase (only if configured)
let app = null;
let db = null;

if (isFirebaseConfigured()) {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        console.log('Firebase initialized successfully');
    } catch (error) {
        console.error('Firebase initialization failed:', error);
    }
}

// ============================================================================
// Community Exam Functions
// ============================================================================

/**
 * Share an exam to the community
 * @param {Object} examData - Exam data including title, author, questions, header
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
export async function shareExamToFirebase(examData) {
    if (!db) {
        console.warn('Firebase not configured. Using localStorage fallback.');
        return shareExamLocally(examData);
    }

    try {
        const docRef = await addDoc(collection(db, "exams"), {
            title: examData.title,
            author: examData.author,
            questions: examData.questions,
            header: examData.header,
            createdAt: serverTimestamp(),
            downloads: 0,
            likes: 0
        });

        console.log('Exam shared successfully with ID:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error("Error sharing exam:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get community exams with optional filters (Issue 8: Server-side filtering)
 * @param {Object} filters - Optional filters { subject, grade, limit }
 * @returns {Promise<Array>}
 */
export async function getCommunityExamsFromFirebase(filters = {}) {
    if (!db) {
        console.warn('Firebase not configured. Using localStorage fallback.');
        return getCommunityExamsLocally(filters);
    }

    try {
        let constraints = [
            orderBy("createdAt", "desc"),
            limit(filters.limit || 50)
        ];

        // Issue 8: Add server-side filters
        if (filters.subject) {
            constraints.push(where("header.subject", "==", filters.subject));
        }
        if (filters.grade) {
            constraints.push(where("header.grade", "==", filters.grade));
        }
        if (filters.country) {
            constraints.push(where("header.country", "==", filters.country));
        }
        if (filters.period) {
            constraints.push(where("header.period", "==", filters.period));
        }
        if (filters.semester) {
            constraints.push(where("header.semester", "==", filters.semester));
        }

        const q = query(collection(db, "exams"), ...constraints);

        const snapshot = await getDocs(q);
        const exams = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || new Date()
        }));

        return exams;
    } catch (error) {
        console.error("Error loading exams:", error);
        // Fallback to localStorage on error
        return getCommunityExamsLocally(filters);
    }
}

/**
 * Get a single exam by ID
 * @param {string} examId 
 * @returns {Promise<Object|null>}
 */
export async function getExamById(examId) {
    if (!db) {
        console.warn('Firebase not configured. Using localStorage fallback.');
        return getExamByIdLocally(examId);
    }

    try {
        const docSnap = await getDoc(doc(db, "exams", examId));
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() };
        }
        return null;
    } catch (error) {
        console.error("Error getting exam:", error);
        return null;
    }
}

/**
 * Delete an exam from the community
 * @param {string} examId 
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteExamFromFirebase(examId) {
    if (!db) {
        return deleteExamLocally(examId);
    }
    try {
        await deleteDoc(doc(db, "exams", examId));
        return { success: true };
    } catch (error) {
        console.error("Error deleting exam:", error);
        return { success: false, error: error.message };
    }
}

function deleteExamLocally(examId) {
    try {
        const exams = JSON.parse(localStorage.getItem('sharedExams') || '[]');
        const filtered = exams.filter(ex => ex.id !== examId);
        localStorage.setItem('sharedExams', JSON.stringify(filtered));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================================================
// LocalStorage Fallback Functions
// ============================================================================

function shareExamLocally(examData) {
    try {
        const existing = JSON.parse(localStorage.getItem('sharedExams') || '[]');
        const newExam = {
            ...examData,
            id: 'local_' + Date.now(),
            createdAt: new Date().toISOString()
        };
        existing.unshift(newExam);
        localStorage.setItem('sharedExams', JSON.stringify(existing));
        return { success: true, id: newExam.id };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function getCommunityExamsLocally(filters = {}) {
    try {
        let exams = JSON.parse(localStorage.getItem('sharedExams') || '[]');

        if (filters.subject) {
            exams = exams.filter(ex => ex.header?.subject?.includes(filters.subject));
        }
        if (filters.grade) {
            exams = exams.filter(ex => ex.header?.grade?.includes(filters.grade));
        }
        if (filters.limit) {
            exams = exams.slice(0, filters.limit);
        }

        return exams;
    } catch (error) {
        console.error("Error loading local exams:", error);
        return [];
    }
}

function getExamByIdLocally(examId) {
    try {
        const exams = JSON.parse(localStorage.getItem('sharedExams') || '[]');
        return exams.find(ex => ex.id === examId) || null;
    } catch (error) {
        return null;
    }
}

// ============================================================================
// Export utility functions
// ============================================================================

export function isFirebaseEnabled() {
    return db !== null;
}

export function getFirebaseStatus() {
    if (!isFirebaseConfigured()) {
        return 'not_configured';
    }
    if (db) {
        return 'connected';
    }
    return 'error';
}

// Default export for convenience
export default {
    shareExam: shareExamToFirebase,
    getCommunityExams: getCommunityExamsFromFirebase,
    getExamById,
    deleteExam: deleteExamFromFirebase,
    isEnabled: isFirebaseEnabled,
    getStatus: getFirebaseStatus
};
