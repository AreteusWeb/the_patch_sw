import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyAawpYZIVfX_VUXnDrYn8lW7JPrZtIy5Aw",
    authDomain: "areteus-chestpad-backend-dev.firebaseapp.com",
    projectId: "areteus-chestpad-backend-dev",
    storageBucket: "areteus-chestpad-backend-dev.firebasestorage.app",
    messagingSenderId: "1048900719191",
    appId: "1:1048900719191:web:4b0626352e3e80dfb24912"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
