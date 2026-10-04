import imgUmSeal from "./9aefa1789ba406d6291f8aa816f84df70a02953b.png";

function LogoContainer() {
  return (
    <div className="content-stretch flex items-start overflow-clip relative rounded-[24px] shrink-0 size-[48px]" data-name="LogoContainer">
      <div className="relative shrink-0 size-[48px]" data-name="UM_Seal">
        <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgUmSeal} />
      </div>
    </div>
  );
}

function BrandText() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[2px] items-start leading-[normal] not-italic relative shrink-0 whitespace-nowrap" data-name="BrandText">
      <p className="font-['Inter:Extra_Bold',sans-serif] font-extrabold relative shrink-0 text-[16px] text-white">UNIVERSITY OF MAKATI</p>
      <p className="font-['Inter:Medium',sans-serif] font-medium relative shrink-0 text-[#d1a153] text-[14px]">{`E-BALIK LOST & FOUND`}</p>
    </div>
  );
}

function Brand() {
  return (
    <div className="content-stretch flex gap-[16px] items-center relative shrink-0" data-name="Brand">
      <LogoContainer />
      <BrandText />
    </div>
  );
}

function RegisterCta() {
  return (
    <div className="bg-[#d1a153] content-stretch flex items-start px-[16px] py-[8px] relative rounded-[6px] shrink-0" data-name="RegisterCTA">
      <p className="[word-break:break-word] font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[normal] not-italic relative shrink-0 text-[#1f3160] text-[15px] whitespace-nowrap">Register</p>
    </div>
  );
}

function NavActions() {
  return (
    <div className="content-stretch flex gap-[32px] items-center relative shrink-0" data-name="NavActions">
      <p className="[word-break:break-word] font-['Inter:Medium',sans-serif] font-medium leading-[normal] not-italic relative shrink-0 text-[15px] text-white whitespace-nowrap">Log In</p>
      <RegisterCta />
    </div>
  );
}

export default function Header() {
  return (
    <div className="bg-[#1f3160] content-stretch flex items-center justify-between px-[64px] relative size-full" data-name="Header">
      <div aria-hidden className="absolute border border-[#d1a153] border-solid inset-0 pointer-events-none" />
      <Brand />
      <NavActions />
    </div>
  );
}