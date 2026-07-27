import Image from "next/image";

export function Logo() {
  return (
    <Image
      src="/logo-closeup.png"
      alt="Closeup Marketing"
      width={40}
      height={40}
      priority
      className="rounded-md"
    />
  );
}
