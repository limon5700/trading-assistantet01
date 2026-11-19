import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './components/AuthProvider';
import { RequireAuth } from './components/RequireAuth';
import { ToastProvider } from './components/ToastProvider';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import PlansPage from './pages/PlansPage';
import ActivationCodesPage from './pages/ActivationCodesPage';
import SettingsPage from './pages/SettingsPage';
import ActivitiesPage from './pages/ActivitiesPage';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <DashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/users"
              element={
                <RequireAuth>
                  <UsersPage />
                </RequireAuth>
              }
            />
            <Route
              path="/plans"
              element={
                <RequireAuth>
                  <PlansPage />
                </RequireAuth>
              }
            />
            <Route
              path="/activation-codes"
              element={
                <RequireAuth>
                  <ActivationCodesPage />
                </RequireAuth>
              }
            />
            <Route
              path="/activities"
              element={
                <RequireAuth>
                  <ActivitiesPage />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <SettingsPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
