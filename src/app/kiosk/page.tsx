import { currentKioskDevice } from '@/lib/kiosk';
import { PinPad } from './pin-pad';

export const dynamic = 'force-dynamic';

export default async function KioskPage() {
  const device = await currentKioskDevice();

  if (!device) {
    return (
      <div className="text-center">
        <h1 className="text-lg font-semibold text-ink-900">This tablet is not set up</h1>
        <p className="mt-2 text-[13px] text-ink-600">
          An administrator registers a kiosk under Admin → Kiosks and opens the one-time setup link on this device.
        </p>
      </div>
    );
  }

  return <PinPad deviceName={device.name} />;
}
