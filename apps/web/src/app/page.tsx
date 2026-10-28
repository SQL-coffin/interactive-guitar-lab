import { GuitarLab } from "@/components/GuitarLab";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";

export default function HomePage() {
  return (
    <GuitarLabServiceProvider>
      <GuitarLab />
    </GuitarLabServiceProvider>
  );
}
