/**
 * Colorful School-Theme Home Page & Registration Portal (Books & Greenery Theme)
 * - Accessible before login: Immediate Student Online MCQ Test entry + Guide to Question Paper & 5-Stage Blueprint creation
 * - School Registration & Login form (persists to Firebase Firestore `school_registrations`)
 * - Verified Admin / Developer Google Sign-In (`shivu.angadi@gmail.com`) for Question Bank, JSON Creator & Diagram Image Management
 */

import React, { useState } from 'react';
import {
  Building2,
  User as UserIcon,
  Mail,
  MapPin,
  ArrowRight,
  GraduationCap,
  FileSpreadsheet,
  FileCheck2,
  ShieldCheck,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ClipboardCheck,
  BookOpen,
  Trees,
  Sparkles,
} from 'lucide-react';
import {
  ADMIN_EMAIL,
  isVerifiedAdminUser,
  signInStudentWithGoogle,
  saveSchoolRegistrationToFirebase,
  getMySchoolRegistrationFromFirebase,
  SchoolRegistrationRecord,
} from '../services/firebase.ts';

import schoolCampusHeroImg from '../assets/images/school_campus_books_hero_1795669358173.jpg';
import booksBlueprintImg from '../assets/images/books_blueprint_study_1795669357964.jpg';
import onlineQuizGreeneryImg from '../assets/images/online_quiz_greenery_1795669361186.jpg';

export interface AppUserSession {
  uid: string;
  role: 'teacher' | 'admin';
  schoolName: string;
  teacherName: string;
  email: string;
  taluk?: string;
  district?: string;
  diseCode?: string;
  medium: string;
  authMethod: 'google' | 'registration';
}

interface HomePortalViewProps {
  defaultSchoolName: string;
  defaultMedium: string;
  totalSubjectsCount: number;
  onAuthenticated: (session: AppUserSession) => void;
  onOpenOnlineTest: () => void;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const HomePortalView: React.FC<HomePortalViewProps> = ({
  defaultSchoolName,
  defaultMedium,
  totalSubjectsCount,
  onAuthenticated,
  onOpenOnlineTest,
}) => {
  const [authTab, setAuthTab] = useState<'school' | 'admin'>('school');

  // School registration form fields
  const [schoolName, setSchoolName] = useState<string>('');
  const [teacherName, setTeacherName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [taluk, setTaluk] = useState<string>('');
  const [district] = useState<string>('');
  const [diseCode, setDiseCode] = useState<string>('');
  const [medium, setMedium] = useState<string>(defaultMedium || 'ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSchoolRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanSchool = schoolName.trim();
    const cleanTeacher = teacherName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanSchool.length < 3) {
      setErrorMessage('ದಯವಿಟ್ಟು ಶಾಲೆಯ ಪೂರ್ಣ ಹೆಸರನ್ನು ನಮೂದಿಸಿ (ಕನಿಷ್ಠ 3 ಅಕ್ಷರಗಳು).');
      return;
    }
    if (cleanTeacher.length < 2) {
      setErrorMessage('ದಯವಿಟ್ಟು ಶಿಕ್ಷಕರ ಅಥವಾ ಮುಖ್ಯೋಪಾಧ್ಯಾಯರ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.');
      return;
    }
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setErrorMessage('ದಯವಿಟ್ಟು ಮಾನ್ಯವಾದ ಇಮೇಲ್ ವಿಳಾಸವನ್ನು ನಮೂದಿಸಿ (ಉದಾ: teacher@gmail.com).');
      return;
    }

    // Security guard: Admin email must authenticate via verified Google Sign-In
    if (cleanEmail === ADMIN_EMAIL) {
      setAuthTab('admin');
      setErrorMessage(
        'ಅಡ್ಮಿನ್ / ಡೆವಲಪರ್ ಪ್ರವೇಶಕ್ಕಾಗಿ ದಯವಿಟ್ಟು "ಅಡ್ಮಿನ್ ಲಾಗಿನ್" ಟ್ಯಾಬ್‌ನಲ್ಲಿ Google ಖಾತೆಯ ಮೂಲಕ ಪರಿಶೀಲಿಸಿ ಲಾಗಿನ್ ಆಗಿ.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const saved: SchoolRegistrationRecord = await saveSchoolRegistrationToFirebase({
        schoolName: cleanSchool.toUpperCase(),
        teacherName: cleanTeacher,
        email: cleanEmail,
        taluk: taluk.trim(),
        district: district.trim(),
        diseCode: diseCode.trim(),
        medium,
      });

      onAuthenticated({
        uid: saved.ownerUid,
        role: 'teacher',
        schoolName: saved.schoolName,
        teacherName: saved.teacherName,
        email: saved.email,
        taluk: saved.taluk,
        district: saved.district,
        diseCode: saved.diseCode,
        medium: saved.medium || medium,
        authMethod: 'registration',
      });
    } catch {
      setErrorMessage('ನೋಂದಣಿ ಪ್ರಕ್ರಿಯೆಯಲ್ಲಿ ತಾಂತ್ರಿಕ ದೋಷ ಉಂಟಾಗಿದೆ. ದಯವಿಟ್ಟು ಮರುಪ್ರಯತ್ನಿಸಿ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async (requireAdmin: boolean) => {
    setErrorMessage(null);
    setIsGoogleLoading(true);
    try {
      const user = await signInStudentWithGoogle();
      const userEmail = (user.email || '').trim().toLowerCase();
      const isAdmin = isVerifiedAdminUser(user);

      if (requireAdmin && !isAdmin) {
        setErrorMessage(
          `ಈ Google ಖಾತೆಗೆ (${userEmail || 'ತಿಳಿದಿಲ್ಲ'}) ಅಡ್ಮಿನ್ ಅನುಮತಿ ಇಲ್ಲ. ಶಿಕ್ಷಕರ ಪ್ರವೇಶಕ್ಕಾಗಿ "ಶಾಲಾ ನೋಂದಣಿ" ಟ್ಯಾಬ್ ಬಳಸಿ.`
        );
        return;
      }

      const existingProfile = await getMySchoolRegistrationFromFirebase();

      if (existingProfile) {
        onAuthenticated({
          uid: user.uid,
          role: isAdmin ? 'admin' : 'teacher',
          schoolName: existingProfile.schoolName || defaultSchoolName,
          teacherName: existingProfile.teacherName || user.displayName || userEmail.split('@')[0],
          email: userEmail,
          taluk: existingProfile.taluk,
          district: existingProfile.district,
          diseCode: existingProfile.diseCode,
          medium: existingProfile.medium || medium,
          authMethod: 'google',
        });
        return;
      }

      const resolvedSchool = schoolName.trim()
        ? schoolName.trim().toUpperCase()
        : isAdmin
          ? defaultSchoolName
          : '';

      if (!resolvedSchool) {
        setTeacherName(user.displayName || '');
        setEmail(userEmail);
        setAuthTab('school');
        setErrorMessage(
          'Google ಖಾತೆ ಪರಿಶೀಲಿಸಲಾಗಿದೆ! ದಯವಿಟ್ಟು ನಿಮ್ಮ ಶಾಲೆಯ ಹೆಸರನ್ನು ನಮೂದಿಸಿ "ನೋಂದಾಯಿಸಿ ಮತ್ತು ಪ್ರವೇಶಿಸಿ" ಕ್ಲಿಕ್ ಮಾಡಿ.'
        );
        return;
      }

      const saved = await saveSchoolRegistrationToFirebase({
        schoolName: resolvedSchool,
        teacherName: teacherName.trim() || user.displayName || 'Teacher',
        email: userEmail,
        taluk: taluk.trim(),
        district: district.trim(),
        diseCode: diseCode.trim(),
        medium,
      });

      onAuthenticated({
        uid: user.uid,
        role: isAdmin ? 'admin' : 'teacher',
        schoolName: saved.schoolName,
        teacherName: saved.teacherName,
        email: saved.email,
        taluk: saved.taluk,
        district: saved.district,
        diseCode: saved.diseCode,
        medium: saved.medium || medium,
        authMethod: 'google',
      });
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setErrorMessage('Google ಲಾಗಿನ್ ಪಾಪ್-ಅಪ್ ಮುಚ್ಚಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.');
      } else {
        setErrorMessage('Google ಲಾಗಿನ್ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಇಮೇಲ್ ನೋಂದಣಿ ಫಾರ್ಮ್ ಬಳಸಿ ಅಥವಾ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.');
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="space-y-10 py-1 sm:py-3 font-kannada">
      {/* FULL-WIDTH SCHOOL CAMPUS BOOKS & GREENERY HERO BANNER */}
      <section className="relative rounded-3xl overflow-hidden shadow-lg border border-emerald-200/80 bg-gradient-to-br from-emerald-900 via-teal-800 to-emerald-950">
        <img
          src={schoolCampusHeroImg}
          alt="ಹಸಿರು ಶಾಲಾ ಆವರಣ, ವರ್ಣರಂಜಿತ ಪಠ್ಯಪುಸ್ತಕಗಳು ಮತ್ತು ಅಧ್ಯಯನ ವಾತಾವರಣ"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-emerald-950/90 via-emerald-950/75 to-teal-950/45"
          aria-hidden="true"
        />

        <div className="relative z-10 px-6 py-8 sm:px-10 sm:py-11 lg:px-12 lg:py-12 max-w-3xl space-y-5 text-white">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-amber-300 tracking-wide">
            <Trees className="w-4 h-4 shrink-0" />
            <span>ಕರ್ನಾಟಕ ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ (DSERT LBA) · ಹಸಿರು ಶಾಲಾ ಮೌಲ್ಯಮಾಪನ ವೇದಿಕೆ</span>
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-tight text-white [text-wrap:balance]">
            ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ, 5-ಹಂತದ ನೀಲನಕಾಶೆ ಮತ್ತು ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷಾ ವೇದಿಕೆ
          </h1>

          <p className="text-sm sm:text-base text-emerald-50/95 leading-relaxed max-w-2xl">
            ಶಿಕ್ಷಕರು ತಮ್ಮ ಶಾಲೆಯ ಹೆಸರಿನೊಂದಿಗೆ ನೋಂದಾಯಿಸಿ ಕೆಲವೇ ಸೆಕೆಂಡುಗಳಲ್ಲಿ ಪಠ್ಯಕ್ರಮ ಆಧಾರಿತ ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ,
            ಅಧಿಕೃತ ಕೀಲಿ ಉತ್ತರ ಮತ್ತು ಪರಸ್ಪರ ಸಮನ್ವಯ ಹೊಂದಿದ 5-ಹಂತದ ನೀಲನಕಾಶೆಯನ್ನು A4 ಮುದ್ರಣಕ್ಕಾಗಿ ಸಿದ್ಧಪಡಿಸಬಹುದು.
          </p>

          {/* Quantitative Highlights Strip */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/20 max-w-xl tabular-nums">
            <div>
              <div className="text-xl sm:text-2xl font-extrabold text-amber-300">
                {Math.max(6, totalSubjectsCount)}+
              </div>
              <div className="text-xs text-emerald-100 mt-0.5">ವಿಷಯಗಳ ಪ್ರಶ್ನೆ ಬ್ಯಾಂಕ್</div>
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-extrabold text-sky-300">5 ಹಂತ</div>
              <div className="text-xs text-emerald-100 mt-0.5">DSERT ಅಧಿಕೃತ ನೀಲನಕಾಶೆ</div>
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-extrabold text-emerald-300">A4 PDF</div>
              <div className="text-xs text-emerald-100 mt-0.5">ಪ್ರಶ್ನೆ &amp; ಕೀಲಿ ಉತ್ತರ ಮುದ್ರಣ</div>
            </div>
          </div>

          {/* Direct Action Triggers */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onOpenOnlineTest}
              className="min-h-[46px] px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-emerald-950 text-sm font-extrabold transition-colors inline-flex items-center gap-2 shadow-md cursor-pointer"
            >
              <ClipboardCheck className="w-4 h-4" />
              <span>ವಿದ್ಯಾರ್ಥಿ ಆನ್‌ಲೈನ್ ಟೆಸ್ಟ್ (ಲಾಗಿನ್ ಅಗತ್ಯವಿಲ್ಲ)</span>
            </button>
            <button
              type="button"
              onClick={() =>
                document.getElementById('school-login-card')?.scrollIntoView({ behavior: 'smooth' })
              }
              className="min-h-[46px] px-5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/35 backdrop-blur-xs text-sm font-bold transition-colors inline-flex items-center gap-2 cursor-pointer"
            >
              <Building2 className="w-4 h-4" />
              <span>ಶಾಲಾ ನೋಂದಣಿ / ಲಾಗಿನ್</span>
            </button>
          </div>
        </div>
      </section>

      {/* CORE SPLIT: PRE-LOGIN ONLINE TEST & HIGHLIGHTS (LEFT) + SCHOOL REGISTRATION WINDOW (RIGHT) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-stretch">
        {/* Left Column: Pre-Login Online MCQ Test Spotlight + Colorful Academic Cards */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Pre-Login Student Online Test Spotlight Card with Books & Greenery Visual */}
          <div className="flex-1 bg-gradient-to-br from-emerald-50 via-teal-50/80 to-green-50 rounded-3xl border border-emerald-200 overflow-hidden shadow-sm flex flex-col">
            <div className="grid grid-cols-1 sm:grid-cols-12 flex-1">
              <div className="sm:col-span-5 relative min-h-[200px] bg-emerald-800 overflow-hidden">
                <img
                  src={onlineQuizGreeneryImg}
                  alt="ವಿದ್ಯಾರ್ಥಿ ಆನ್‌ಲೈನ್ ಬಹು ಆಯ್ಕೆ ಪರೀಕ್ಷೆ ಮತ್ತು ಹಸಿರು ಪುಸ್ತಕಗಳ ಮೇಜು"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-emerald-950/60 via-transparent to-transparent sm:bg-gradient-to-r sm:from-transparent sm:to-emerald-950/15"
                  aria-hidden="true"
                />
              </div>

              <div className="sm:col-span-7 p-6 sm:p-7 flex flex-col justify-between gap-4">
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-800">
                    <GraduationCap className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ನೇರ ಪ್ರವೇಶ · ಶಾಲಾ ಲಾಗಿನ್ ಅಗತ್ಯವಿಲ್ಲ</span>
                  </div>
                  <h2 className="text-xl font-extrabold text-emerald-950 leading-snug">
                    ಆನ್‌ಲೈನ್ ಬಹು ಆಯ್ಕೆ ಪರೀಕ್ಷೆ (Online MCQ Test)
                  </h2>
                  <p className="text-xs sm:text-sm text-emerald-900/85 leading-relaxed">
                    ವಿದ್ಯಾರ್ಥಿಗಳು ತಮ್ಮ ಇಮೇಲ್ ಐಡಿ ಬಳಸಿ ತರಗತಿ, ವಿಷಯ, ಪಾಠಗಳು ಮತ್ತು ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ
                    ಆಯ್ಕೆಮಾಡಿ ತಕ್ಷಣ ಪರೀಕ್ಷೆ ಬರೆಯಬಹುದು. ಪರೀಕ್ಷೆ ಮುಗಿದ ತಕ್ಷಣ ಅಂಕಗಳು, ಸರಿ-ತಪ್ಪು
                    ಉತ್ತರಗಳ ವಿವರಣೆ ಮತ್ತು ಉತ್ತರ ಪತ್ರಿಕೆಯ ಪ್ರತಿ ಲಭ್ಯವಾಗುತ್ತದೆ.
                  </p>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={onOpenOnlineTest}
                    className="w-full sm:w-auto min-h-[46px] px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white text-sm font-bold transition-colors inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    <ClipboardCheck className="w-4 h-4" />
                    <span>ಆನ್‌ಲೈನ್ ಟೆಸ್ಟ್ ಪ್ರಾರಂಭಿಸಿ</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Two Colorful Academic Highlight Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="rounded-2xl bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 border border-sky-200 p-5 space-y-2.5 shadow-2xs">
              <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shadow-xs">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-sky-950">
                100% ಪಠ್ಯಕ್ರಮ ಆಧಾರಿತ ಪ್ರಶ್ನೆಗಳು
              </h3>
              <p className="text-xs text-sky-900/80 leading-relaxed">
                6ನೇ ತರಗತಿಯಿಂದ 10ನೇ ತರಗತಿಯವರೆಗೆ ಗಣಿತ, ವಿಜ್ಞಾನ, ಸಮಾಜ ವಿಜ್ಞಾನ, ಕನ್ನಡ, ಇಂಗ್ಲಿಷ್ ಮತ್ತು
                ಹಿಂದಿ ಪಠ್ಯಪುಸ್ತಕಗಳ ಅಧಿಕೃತ ಪ್ರಶ್ನೆ ಭಂಡಾರ ಲಭ್ಯವಿದೆ.
              </p>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 border border-amber-200 p-5 space-y-2.5 shadow-2xs">
              <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-xs">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-amber-950">
                ನಿಖರ ಅಂಕ &amp; ಪ್ರಶ್ನೆ ಸಮನ್ವಯ
              </h3>
              <p className="text-xs text-amber-900/80 leading-relaxed">
                10 ಅಂಕಗಳಿಗೆ 10 ಪ್ರಶ್ನೆಗಳಿಂದ ಹಿಡಿದು 100 ಅಂಕಗಳವರೆಗೆ ಯಾವುದೇ ಪರೀಕ್ಷಾ ಮಾದರಿಯನ್ನು
                ಆಯ್ಕೆಮಾಡಿದರೂ ಹಂತ 2 ಮತ್ತು ಹಂತ 5 ನೀಲನಕಾಶೆ ನಿಖರವಾಗಿ ಹೊಂದಿಕೊಳ್ಳುತ್ತದೆ.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Vibrant School Registration & Login Window */}
        <div
          id="school-login-card"
          className="lg:col-span-5 bg-white rounded-3xl border border-emerald-200 shadow-md overflow-hidden flex flex-col"
        >
          {/* Lush School Greenery Card Header */}
          <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 px-6 py-5 text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold tracking-tight text-white">
                  ಶಾಲಾ ನೋಂದಣಿ ಮತ್ತು ಲಾಗಿನ್
                </h2>
                <p className="text-xs text-emerald-100">
                  ಶಾಲೆಯ ಮಾಹಿತಿ ತುಂಬಿ ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ವೇದಿಕೆ ಪ್ರವೇಶಿಸಿ
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 flex-1 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              {/* Segmented Role Tabs */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-emerald-50 border border-emerald-200/80 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('school');
                    setErrorMessage(null);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    authTab === 'school'
                      ? 'bg-emerald-700 text-white shadow-xs'
                      : 'text-emerald-900 hover:bg-emerald-100/70'
                  }`}
                >
                  ಶಾಲಾ / ಶಿಕ್ಷಕರ ಲಾಗಿನ್
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('admin');
                    setErrorMessage(null);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    authTab === 'admin'
                      ? 'bg-indigo-700 text-white shadow-xs'
                      : 'text-emerald-900 hover:bg-emerald-100/70'
                  }`}
                >
                  ಅಡ್ಮಿನ್ / ಡೆವಲಪರ್
                </button>
              </div>

              {authTab === 'school' ? (
                <div className="space-y-4">
                  <form onSubmit={handleSchoolRegistrationSubmit} className="space-y-3.5">
                    <div>
                      <label
                        htmlFor="reg-school-name"
                        className="block text-xs font-bold text-emerald-950 mb-1"
                      >
                        ಶಾಲೆಯ ಹೆಸರು (School Name) *
                      </label>
                      <div className="relative">
                        <Building2 className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="reg-school-name"
                          type="text"
                          required
                          maxLength={180}
                          value={schoolName}
                          onChange={e => setSchoolName(e.target.value)}
                          placeholder="ಉದಾ: GOVT KHPS NINGYANATTI"
                          className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/30 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="reg-teacher-name"
                          className="block text-xs font-bold text-emerald-950 mb-1"
                        >
                          ಶಿಕ್ಷಕರ ಹೆಸರು *
                        </label>
                        <div className="relative">
                          <UserIcon className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            id="reg-teacher-name"
                            type="text"
                            required
                            maxLength={120}
                            value={teacherName}
                            onChange={e => setTeacherName(e.target.value)}
                            placeholder="ನಿಮ್ಮ ಹೆಸರು"
                            className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/30 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="reg-email"
                          className="block text-xs font-bold text-emerald-950 mb-1"
                        >
                          ಇಮೇಲ್ ಐಡಿ *
                        </label>
                        <div className="relative">
                          <Mail className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            id="reg-email"
                            type="email"
                            required
                            maxLength={160}
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="school@gmail.com"
                            className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/30 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="reg-taluk"
                          className="block text-xs font-bold text-emerald-950 mb-1"
                        >
                          ತಾಲ್ಲೂಕು / ಜಿಲ್ಲೆ
                        </label>
                        <div className="relative">
                          <MapPin className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            id="reg-taluk"
                            type="text"
                            maxLength={100}
                            value={taluk}
                            onChange={e => setTaluk(e.target.value)}
                            placeholder="ಉದಾ: ಬೆಳಗಾವಿ"
                            className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/30 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="reg-dise"
                          className="block text-xs font-bold text-emerald-950 mb-1"
                        >
                          DISE ಕೋಡ್ (ಐಚ್ಛಿಕ)
                        </label>
                        <input
                          id="reg-dise"
                          type="text"
                          maxLength={32}
                          value={diseCode}
                          onChange={e => setDiseCode(e.target.value)}
                          placeholder="2901..."
                          className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/30 text-sm text-slate-900 placeholder:text-slate-400 tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-medium"
                        className="block text-xs font-bold text-emerald-950 mb-1"
                      >
                        ಬೋಧನಾ ಮಾಧ್ಯಮ
                      </label>
                      <select
                        id="reg-medium"
                        value={medium}
                        onChange={e => setMedium(e.target.value)}
                        className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/30 text-sm font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600"
                      >
                        <option value="ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)">ಕನ್ನಡ ಮಾಧ್ಯಮ (State Syllabus)</option>
                        <option value="English Medium">English Medium</option>
                      </select>
                    </div>

                    {errorMessage && (
                      <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <span>{errorMessage}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      <span>ನೋಂದಾಯಿಸಿ ಮತ್ತು ಪ್ರವೇಶಿಸಿ (Register &amp; Login)</span>
                    </button>
                  </form>

                  <div className="relative flex items-center">
                    <div className="flex-grow border-t border-emerald-200" />
                    <span className="px-3 text-xs text-emerald-700 font-semibold">ಅಥವಾ</span>
                    <div className="flex-grow border-t border-emerald-200" />
                  </div>

                  <button
                    type="button"
                    disabled={isGoogleLoading}
                    onClick={() => handleGoogleLogin(false)}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-sky-200 bg-sky-50/60 hover:bg-sky-100/80 text-sky-950 text-xs font-bold transition-colors flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer"
                  >
                    {isGoogleLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
                    ) : (
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                        <path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z" />
                        <path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 0 0 0 10.76l3.98-3.09z" />
                        <path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
                      </svg>
                    )}
                    <span>Google ಖಾತೆಯೊಂದಿಗೆ ಶಾಲಾ ಲಾಗಿನ್</span>
                  </button>
                </div>
              ) : (
                /* Admin / Developer Verified Login Panel */
                <div className="space-y-4 pt-2">
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50 to-sky-50 border border-indigo-200 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-extrabold text-indigo-950">
                      <ShieldCheck className="w-4 h-4 text-indigo-700 shrink-0" />
                      <span>ಅಡ್ಮಿನ್ ಮತ್ತು ಡೆವಲಪರ್ ನಿಯಂತ್ರಣ ಕೇಂದ್ರ</span>
                    </div>
                    <p className="text-xs text-indigo-900/85 leading-relaxed">
                      ಪ್ರಶ್ನೆ ಭಂಡಾರ ನಿರ್ವಹಣೆ, AI JSON ಫೈಲ್ ಕ್ರಿಯೇಟರ್, ಹಾಗೂ 6ನೇ ತರಗತಿ ಸೇರಿದಂತೆ ಎಲ್ಲಾ
                      ವಿಷಯಗಳ ಪ್ರಶ್ನೆಗಳಿಗೆ ಚಿತ್ರಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ ಸೇರಿಸುವ ಸೌಲಭ್ಯಗಳು ಕೇವಲ ಪರಿಶೀಲಿತ ಅಡ್ಮಿನ್
                      ಖಾತೆಗೆ ಮಾತ್ರ ಲಭ್ಯವಿರುತ್ತವೆ.
                    </p>
                  </div>

                  {errorMessage && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={isGoogleLoading}
                    onClick={() => handleGoogleLogin(true)}
                    className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-700 to-purple-700 hover:from-indigo-800 hover:to-purple-800 text-white text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer"
                  >
                    {isGoogleLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" />
                    )}
                    <span>Google ಮೂಲಕ ಅಡ್ಮಿನ್ ಲಾಗಿನ್ ಆಗಿ</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <p className="text-[11px] text-slate-500 text-center">
                    ಅಧಿಕೃತ ಡೆವಲಪರ್ Google ಖಾತೆಯ ಮೂಲಕ ಮಾತ್ರ ಪ್ರವೇಶ ಅನುಮತಿಸಲಾಗಿದೆ.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* COLORFUL GUIDE CARDS: How to Create Question Papers & Official 5-Stage Blueprint */}
      <section id="how-it-works" className="space-y-6 pt-2">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="max-w-2xl">
            <div className="text-xs font-extrabold text-emerald-700 tracking-wide">
              ಬಳಕೆಯ ಮಾರ್ಗದರ್ಶಿ · ಪುಸ್ತಕಗಳು ಮತ್ತು ನೀಲನಕಾಶೆ
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-emerald-950 tracking-tight mt-1 [text-wrap:balance]">
              ಪ್ರಶ್ನೆಪತ್ರಿಕೆ ಮತ್ತು ಅಧಿಕೃತ ನೀಲನಕಾಶೆಯನ್ನು ರಚಿಸಿಕೊಳ್ಳುವ ವಿಧಾನ
            </h2>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
              ಶಾಲಾ ನೋಂದಣಿಯ ನಂತರ ಶಿಕ್ಷಕರಿಗೆ ಸರಳ, ವರ್ಣರಂಜಿತ ಮತ್ತು ವೇಗದ ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನಾ ವೇದಿಕೆ ತೆರೆಯುತ್ತದೆ.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 01: Question Paper Creation (Royal Sky-Blue & Indigo Theme + Books Visual) */}
          <article className="rounded-3xl bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 border border-sky-200 overflow-hidden shadow-sm flex flex-col">
            <div className="h-40 w-full bg-sky-800 relative overflow-hidden">
              <img
                src={booksBlueprintImg}
                alt="ಪಠ್ಯಪುಸ್ತಕಗಳು, ನೀಲನಕಾಶೆ ಮತ್ತು ಅಧ್ಯಯನ ಸಾಮಗ್ರಿಗಳು"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-sky-950/75 via-sky-900/20 to-transparent"
                aria-hidden="true"
              />
              <div className="absolute bottom-3 left-5 right-5 flex items-center justify-between text-white">
                <span className="text-xs font-extrabold tracking-wider tabular-nums">ಹಂತ 01</span>
                <FileCheck2 className="w-5 h-5 text-sky-200" />
              </div>
            </div>
            <div className="p-6 space-y-2.5 flex-1">
              <h3 className="text-base font-extrabold text-sky-950">
                ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ರಚನೆ (Question Paper)
              </h3>
              <p className="text-xs sm:text-sm text-sky-950/80 leading-relaxed">
                ಲಾಗಿನ್ ಆದ ನಂತರ ತರಗತಿ, ವಿಷಯ, ಪಾಠಗಳು, ಒಟ್ಟು ಅಂಕಗಳು, ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ ಮತ್ತು ಪ್ರಶ್ನೆಗಳ
                ವಿಧಗಳನ್ನು (ಬಹು ಆಯ್ಕೆ, ಕಿರು ಉತ್ತರ, ದೀರ್ಘ ಉತ್ತರ, ಪ್ರಬಂಧ ಮಾದರಿ) ಆಯ್ಕೆಮಾಡಿ ಒಂದೇ ಕ್ಲಿಕ್‌ನಲ್ಲಿ
                A4 ಮುದ್ರಣ ಸಿದ್ಧ ಪ್ರಶ್ನೆ ಪತ್ರಿಕೆ ಮತ್ತು ಕೀಲಿ ಉತ್ತರ ಪಡೆಯಬಹುದು.
              </p>
            </div>
          </article>

          {/* Card 02: 5-Stage Official Blueprint (Warm Sunlit Amber & Marigold Theme) */}
          <article className="rounded-3xl bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 border border-amber-200 overflow-hidden shadow-sm flex flex-col">
            <div className="h-40 w-full bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 p-5 flex flex-col justify-between text-white relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold tracking-wider tabular-nums text-amber-100">
                  ಹಂತ 02
                </span>
                <FileSpreadsheet className="w-6 h-6 text-amber-100" />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 text-center tabular-nums">
                <div className="bg-white/20 backdrop-blur-xs rounded-xl py-2 px-1.5 border border-white/25">
                  <div className="text-sm font-black">ವ.ನಿ/ಕಿರು</div>
                  <div className="text-[10px] text-amber-100">1 ಅಂಕ</div>
                </div>
                <div className="bg-white/20 backdrop-blur-xs rounded-xl py-2 px-1.5 border border-white/25">
                  <div className="text-sm font-black">ದೀರ್ಘ</div>
                  <div className="text-[10px] text-amber-100">2-3 ಅಂಕ</div>
                </div>
                <div className="bg-white/20 backdrop-blur-xs rounded-xl py-2 px-1.5 border border-white/25">
                  <div className="text-sm font-black">ಪ್ರಬಂಧ</div>
                  <div className="text-[10px] text-amber-100">4 ಅಂಕ</div>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-2.5 flex-1">
              <h3 className="text-base font-extrabold text-amber-950">
                5-ಹಂತದ ಅಧಿಕೃತ ನೀಲನಕಾಶೆ (Blue Print)
              </h3>
              <p className="text-xs sm:text-sm text-amber-950/80 leading-relaxed">
                ಉದ್ದಿಷ್ಟವಾರು ಹಂಚಿಕೆ (ಜ್ಞಾನ, ತಿಳುವಳಿಕೆ, ಅನ್ವಯ, ಕೌಶಲ), ಪ್ರಶ್ನೆವಾರು ಹಂಚಿಕೆ
                (ವಸ್ತುನಿಷ್ಠ/ಕಿರು, ದೀರ್ಘ, ಪ್ರಬಂಧ), ಘಟಕವಾರು ಅಂಕ ಹಂಚಿಕೆ ಮತ್ತು ತ್ರಿಮುಖ ಮಾಸ್ಟರ್ ಕೋಷ್ಟಕ —
                ಎಲ್ಲಾ 5 ಹಂತಗಳು ನಿಖರವಾಗಿ ಪರಸ್ಪರ ಸಮನ್ವಯಗೊಂಡು ಮುದ್ರಣಕ್ಕೆ ಸಿದ್ಧವಾಗುತ್ತವೆ.
              </p>
            </div>
          </article>

          {/* Card 03: Student Online MCQ Test (Lush Botanical Emerald & Forest Green Theme) */}
          <article className="rounded-3xl bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 border border-emerald-200 overflow-hidden shadow-sm flex flex-col">
            <div className="h-40 w-full bg-gradient-to-br from-emerald-600 via-teal-600 to-green-700 p-5 flex flex-col justify-between text-white">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold tracking-wider tabular-nums text-emerald-100">
                  ಹಂತ 03
                </span>
                <GraduationCap className="w-6 h-6 text-emerald-100" />
              </div>
              <div className="space-y-1">
                <div className="text-lg font-extrabold leading-tight">
                  ತಕ್ಷಣ ಫಲಿತಾಂಶ &amp; ಉತ್ತರ ಪತ್ರಿಕೆ
                </div>
                <div className="text-xs text-emerald-100">
                  ಮೊಬೈಲ್ ಮತ್ತು ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲಿ ಸುಲಭ ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷೆ
                </div>
              </div>
            </div>
            <div className="p-6 space-y-2.5 flex-1">
              <h3 className="text-base font-extrabold text-emerald-950">
                ವಿದ್ಯಾರ್ಥಿ ಆನ್‌ಲೈನ್ ಪರೀಕ್ಷೆ (Online Test)
              </h3>
              <p className="text-xs sm:text-sm text-emerald-950/80 leading-relaxed">
                ಶಾಲಾ ಲಾಗಿನ್ ಇಲ್ಲದೆಯೂ ವಿದ್ಯಾರ್ಥಿಗಳು ತಮ್ಮ ಇಮೇಲ್ ಐಡಿ ಬಳಸಿ ಕೇವಲ ಬಹು ಆಯ್ಕೆ (MCQ)
                ಪರೀಕ್ಷೆ ನೀಡಬಹುದು. ಪರೀಕ್ಷೆ ಮುಗಿದ ತಕ್ಷಣ ಅಂಕಗಳು, ಸರಿ/ತಪ್ಪು ಉತ್ತರಗಳ ವಿವರಣೆ ಮತ್ತು
                ಬಿಡಿಸಿದ ಪ್ರಶ್ನೆ-ಉತ್ತರಗಳ ಪ್ರತಿ ಇಮೇಲ್‌ಗೆ ತಲುಪುತ್ತದೆ.
              </p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
};
