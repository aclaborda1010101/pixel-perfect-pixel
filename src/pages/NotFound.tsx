import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <Eyebrow>Error · Página no encontrada</Eyebrow>
        <h1 className="mt-3 font-editorial text-7xl tracking-notarial text-foreground">404</h1>
        <p className="mt-4 text-base text-muted-foreground">
          La página <span className="font-mono text-foreground">{location.pathname}</span> no existe en el panel.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button asChild variant="gold" size="sm">
            <Link to="/"><ArrowLeft className="h-3 w-3" /> Volver al panel</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
