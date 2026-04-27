import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Ctx = {
  title: string | null;
  setTitle: (t: string | null) => void;
};

const PageTitleContext = createContext<Ctx>({ title: null, setTitle: () => {} });

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <PageTitleContext.Provider value={{ title, setTitle }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle() {
  return useContext(PageTitleContext);
}

/** Registers the current page H1 so the Topbar breadcrumb can show it
 *  instead of a UUID for the last crumb segment. */
export function useRegisterPageTitle(title: string | null | undefined) {
  const { setTitle } = usePageTitle();
  useEffect(() => {
    setTitle(title ?? null);
    return () => setTitle(null);
  }, [title, setTitle]);
}
