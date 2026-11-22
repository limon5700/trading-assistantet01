import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/ToastProvider';
import { ApiError, api } from '../lib/api';
import type { Branding, CmsPage } from '../lib/types';

const BANNED_EXTENSIONS = /\.(exe|apk|zip|php|js)$/i;

export default function BrandingPage() {
  const toast = useToast();
  const iconInput = useRef<HTMLInputElement>(null);

  const [branding, setBranding] = useState<Branding | null>(null);
  const [appName, setAppName] = useState('');
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [terms, setTerms] = useState({ title: 'Terms & Conditions', content: '' });
  const [about, setAbout] = useState({ title: 'About Us', content: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [savingPage, setSavingPage] = useState<'terms' | 'about' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [brandingResponse, cmsResponse] = await Promise.all([api.getBranding(), api.listCmsPages()]);
      setBranding(brandingResponse.branding);
      setAppName(brandingResponse.branding.app_name ?? '');
      setPages(cmsResponse.items);

      const termsPage = cmsResponse.items.find((page) => page.slug === 'terms');
      const aboutPage = cmsResponse.items.find((page) => page.slug === 'about');
      setTerms({
        title: termsPage?.title ?? 'Terms & Conditions',
        content: termsPage?.content ?? '',
      });
      setAbout({ title: aboutPage?.title ?? 'About Us', content: aboutPage?.content ?? '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load branding and pages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = appName.trim();
    if (!value) {
      setError('App name is required.');
      return;
    }
    setSavingName(true);
    setError(null);
    try {
      const { settings } = await api.updateSettings({ app_name: value });
      setBranding((current) => (current ? { ...current, app_name: settings.app_name } : current));
      setAppName(settings.app_name);
      toast.success('App name saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the app name.');
    } finally {
      setSavingName(false);
    }
  }

  async function handleIconChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || BANNED_EXTENSIONS.test(file.name)) {
      setError('Choose a PNG, JPEG, WEBP, SVG or ICO image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('The icon must be 2 MB or smaller.');
      return;
    }

    setUploadingIcon(true);
    setError(null);
    try {
      const result = await api.uploadBrandingIcon(file);
      setBranding((current) =>
        current
          ? {
              ...current,
              app_icon_url: result.app_icon_url,
              app_icon_full_url: result.app_icon_full_url,
            }
          : current,
      );
      toast.success('App icon updated. The mobile app picks it up from /api/public/config.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the app icon.');
    } finally {
      setUploadingIcon(false);
    }
  }

  async function removeIcon() {
    setUploadingIcon(true);
    setError(null);
    try {
      await api.deleteBrandingIcon();
      setBranding((current) =>
        current ? { ...current, app_icon_url: '', app_icon_full_url: '' } : current,
      );
      toast.success('App icon removed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the app icon.');
    } finally {
      setUploadingIcon(false);
    }
  }

  async function clearPage(slug: 'terms' | 'about') {
    const label = slug === 'terms' ? 'Terms & Conditions' : 'About Us';
    if (!window.confirm(`Delete the published ${label} content? The app will show it as not published.`)) {
      return;
    }
    setSavingPage(slug);
    setError(null);
    try {
      const { item } = await api.deleteCmsPage(slug);
      setPages((current) => current.map((page) => (page.slug === slug ? item : page)));
      if (slug === 'terms') setTerms({ title: item.title, content: item.content });
      else setAbout({ title: item.title, content: item.content });
      toast.success(`${label} content cleared.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this page.');
    } finally {
      setSavingPage(null);
    }
  }

  async function savePage(slug: 'terms' | 'about') {
    const value = slug === 'terms' ? terms : about;
    if (!value.title.trim()) {
      setError('The page title is required.');
      return;
    }
    setSavingPage(slug);
    setError(null);
    try {
      const { item } = await api.saveCmsPage(slug, {
        title: value.title.trim(),
        content: value.content,
      });
      setPages((current) => {
        const without = current.filter((page) => page.slug !== slug);
        return [...without, item];
      });
      if (slug === 'terms') setTerms({ title: item.title, content: item.content });
      else setAbout({ title: item.title, content: item.content });
      toast.success(`${item.title} saved.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this page.');
    } finally {
      setSavingPage(null);
    }
  }

  return (
    <AppShell>
      <div className="max-w-4xl space-y-5">
        <div>
          <h1 className="text-base font-semibold text-slate-900">App branding &amp; pages</h1>
          <p className="text-xs text-slate-500">
            The mobile app reads the app name, icon, Terms &amp; Conditions and About content from{' '}
            <code>/api/public/config</code> on launch.
          </p>
        </div>

        {loading ? (
          <div className="card flex items-center justify-center py-14">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
          </div>
        ) : (
          <>
            <section className="card space-y-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Brand identity</h2>
                  <p className="text-xs text-slate-500">Shown on the auth screen and the app header.</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                  {pages.length} page(s) published
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {branding?.app_icon_full_url ? (
                    <img
                      src={branding.app_icon_full_url}
                      alt="Current app icon"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xs font-semibold text-slate-400">No icon</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={iconInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
                    className="hidden"
                    onChange={(event) => void handleIconChange(event)}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => iconInput.current?.click()}
                    disabled={uploadingIcon}
                  >
                    {uploadingIcon ? 'Uploading…' : 'Upload icon'}
                  </button>
                  <button
                    type="button"
                    className="btn !px-2.5 !py-1.5 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => void removeIcon()}
                    disabled={uploadingIcon || !branding?.app_icon_url}
                  >
                    Remove
                  </button>
                  <p className="w-full text-xs text-slate-400">
                    PNG, JPEG, WEBP, SVG or ICO · max 2 MB. Stored under {branding?.app_icon_url ? branding.app_icon_url : '/uploads/branding/'}.
                  </p>
                </div>
              </div>

              <form onSubmit={saveName} className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                  <label className="label" htmlFor="brand-app-name">
                    App name
                  </label>
                  <input
                    id="brand-app-name"
                    className="input"
                    maxLength={80}
                    value={appName}
                    onChange={(event) => setAppName(event.target.value)}
                    placeholder="AI Trading Assistant"
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={savingName}>
                  {savingName ? 'Saving…' : 'Save name'}
                </button>
              </form>
            </section>

            {(['terms', 'about'] as const).map((slug) => {
              const value = slug === 'terms' ? terms : about;
              const setter = slug === 'terms' ? setTerms : setAbout;
              const page = pages.find((item) => item.slug === slug);
              return (
                <section key={slug} className="card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        {slug === 'terms' ? 'Terms & Conditions' : 'About Us'}
                      </h2>
                      <p className="text-xs text-slate-500">
                        Markdown is supported. {page ? `Last updated ${page.updated_at} UTC.` : 'Not saved yet.'}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400">{value.content.length} characters</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="label" htmlFor={`${slug}-title`}>
                        Page title
                      </label>
                      <input
                        id={`${slug}-title`}
                        className="input"
                        maxLength={255}
                        value={value.title}
                        onChange={(event) => setter({ ...value, title: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor={`${slug}-content`}>
                        Content
                      </label>
                      <textarea
                        id={`${slug}-content`}
                        className="input min-h-[260px] resize-y font-mono text-[13px] leading-6"
                        value={value.content}
                        onChange={(event) => setter({ ...value, content: event.target.value })}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void savePage(slug)}
                        disabled={savingPage !== null}
                      >
                        {savingPage === slug ? 'Saving…' : 'Save page'}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => void load()}>
                        Reset
                      </button>
                      <button
                        type="button"
                        className="btn !px-2.5 !py-1.5 text-xs text-red-600 hover:bg-red-50"
                        onClick={() => void clearPage(slug)}
                        disabled={savingPage !== null}
                      >
                        Delete content
                      </button>
                    </div>
                  </div>
                </section>
              );
            })}
          </>
        )}

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
