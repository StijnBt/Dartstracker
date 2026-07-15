import { branding } from "./branding";

export default function App() {
  return (
    <div className="flex items-center gap-3 p-4">
      <img src={branding.logoSrc} alt={branding.appName} width={40} height={40} />
      <h1 className="text-primary font-heading text-3xl font-bold">
        {branding.appName}
      </h1>
    </div>
  );
}
