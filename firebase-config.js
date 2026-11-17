// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹)에서 복사한 값. 공개돼도 괜찮아요(실제 권한은 firestore.rules가 막아요).
export const firebaseConfig = {
  apiKey: "AIzaSyBlmA3fqLJYuhc-bd250kTu1ndond7YD60",
  authDomain: "runners-prepare.firebaseapp.com",
  projectId: "runners-prepare",
  storageBucket: "runners-prepare.firebasestorage.app",
  messagingSenderId: "246485244918",
  appId: "1:246485244918:web:1050889a713bf8e18085d7"
};

// Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서의 "키 쌍" (공개 키). 비어 있으면 알림 기능이 꺼져 있어요.
export const vapidKey = "BKaQyYr7u5cp3Irh85R5q4tpsr_LPMHZvrMjRw4eathhuWFd83VBnPoq_PtfZEJ82yrc6ea2A8_VpEwHDeFHtqI";
