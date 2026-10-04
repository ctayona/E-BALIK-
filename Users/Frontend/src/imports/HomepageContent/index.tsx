import svgPaths from "./svg-ujfgfqrqkd";
import imgItemImage from "./3d6bdb4447adc3a228658a53e0f6b2c51800b629.png";
import imgItemImage1 from "./9849552c1543beeec74eaa38d1d3631d150da40e.png";
import imgItemImage2 from "./d84b18b7ed016504081dedbc2ce5f8938fe1f266.png";
import imgItemImage3 from "./3131b8e529e0baa1de14cd75a2ad6b925ff2eaa5.png";

function DatabaseSearch() {
  return (
    <div className="relative shrink-0 size-[40px]" data-name="database-search">
      <svg className="absolute block inset-0 size-full" fill="none" height="40" preserveAspectRatio="none" viewBox="0 0 40 40" width="40">
        <g id="database-search">
          <path d={svgPaths.p17efe900} id="Vector" stroke="#D1A153" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function HeroIcon() {
  return (
    <div className="bg-[#1f3160] content-stretch flex flex-col items-center justify-center relative rounded-[40px] shrink-0 size-[80px]" data-name="HeroIcon">
      <DatabaseSearch />
    </div>
  );
}

function HeroText() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[16px] items-center not-italic relative shrink-0 text-center w-[800px]" data-name="HeroText">
      <p className="font-['Inter:Extra_Bold',sans-serif] font-extrabold leading-[normal] relative shrink-0 text-[#1f3160] text-[42px] w-full">{`E-Balik: Your Smart Campus Lost & Found`}</p>
      <p className="font-['Inter:Regular',sans-serif] font-normal leading-[28px] relative shrink-0 text-[#475569] text-[18px] w-full">{`Report lost items, search found inventory, and get matched automatically with the University of Makati's integrated recovery network.`}</p>
    </div>
  );
}

function PlusCircle() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="plus-circle">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_17)" id="plus-circle">
          <path d={svgPaths.p1a4ad880} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_17">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function PrimaryCta() {
  return (
    <div className="bg-[#1f3160] content-stretch flex gap-[8px] items-center px-[28px] py-[14px] relative rounded-[8px] shrink-0" data-name="PrimaryCTA">
      <PlusCircle />
      <p className="[word-break:break-word] font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[normal] not-italic relative shrink-0 text-[16px] text-white whitespace-nowrap">Report a Lost Item</p>
    </div>
  );
}

function Search() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="search">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="search">
          <path d={svgPaths.p1615880} id="Vector" stroke="#1F3160" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function SecondaryCta() {
  return (
    <div className="content-stretch flex gap-[8px] items-center px-[28px] py-[14px] relative rounded-[8px] shrink-0" data-name="SecondaryCTA">
      <div aria-hidden className="absolute border-[#1f3160] border-[1.5px] border-solid inset-0 pointer-events-none rounded-[8px]" />
      <Search />
      <p className="[word-break:break-word] font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[normal] not-italic relative shrink-0 text-[#1f3160] text-[16px] whitespace-nowrap">Check Found Inventory</p>
    </div>
  );
}

function HeroActions() {
  return (
    <div className="content-stretch flex gap-[16px] items-center relative shrink-0" data-name="HeroActions">
      <PrimaryCta />
      <SecondaryCta />
    </div>
  );
}

function HeroSection() {
  return (
    <div className="bg-gradient-to-b content-stretch flex flex-col from-[#f1f5f9] gap-[32px] items-center px-[64px] py-[80px] relative shrink-0 to-[#e2e8f0] w-full" data-name="HeroSection">
      <HeroIcon />
      <HeroText />
      <HeroActions />
    </div>
  );
}

function SectionHeader() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-start leading-[normal] not-italic relative shrink-0 w-full" data-name="SectionHeader">
      <p className="font-['Inter:Bold',sans-serif] font-bold relative shrink-0 text-[#d1a153] text-[14px] uppercase whitespace-nowrap">HOW IT WORKS</p>
      <p className="font-['Inter:Extra_Bold',sans-serif] font-extrabold min-w-full relative shrink-0 text-[#0f172a] text-[28px] w-[min-content]">Automated Recovery Services</p>
    </div>
  );
}

function Link() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="link-2">
      <svg className="absolute block inset-0 size-full" fill="none" height="24" preserveAspectRatio="none" viewBox="0 0 24 24" width="24">
        <g id="link-2">
          <path d={svgPaths.p3bdf9b60} id="Vector" stroke="#1F3160" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CardIcon() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex flex-col items-center justify-center relative rounded-[8px] shrink-0 size-[48px]" data-name="CardIcon">
      <Link />
    </div>
  );
}

function CardContent() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-start not-italic relative shrink-0 w-full" data-name="CardContent">
      <p className="font-['Inter:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#0f172a] text-[18px] w-full">Automated Matching</p>
      <p className="font-['Inter:Regular',sans-serif] font-normal leading-[22px] relative shrink-0 text-[#475569] text-[14px] w-full">Our system analyzes descriptions and alerts owners automatically when a matching found item is logged.</p>
    </div>
  );
}

function FeatureCard() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_66px] flex-col gap-[16px] items-start min-w-px p-[32px] relative rounded-[12px]" data-name="FeatureCard">
      <div aria-hidden className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CardIcon />
      <CardContent />
    </div>
  );
}

function Search1() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="search">
      <svg className="absolute block inset-0 size-full" fill="none" height="24" preserveAspectRatio="none" viewBox="0 0 24 24" width="24">
        <g id="search">
          <path d={svgPaths.p1cfabb40} id="Vector" stroke="#1F3160" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CardIcon1() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex flex-col items-center justify-center relative rounded-[8px] shrink-0 size-[48px]" data-name="CardIcon">
      <Search1 />
    </div>
  );
}

function CardContent1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-start not-italic relative shrink-0 w-full" data-name="CardContent">
      <p className="font-['Inter:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#0f172a] text-[18px] w-full">Inventory Search</p>
      <p className="font-['Inter:Regular',sans-serif] font-normal leading-[22px] relative shrink-0 text-[#475569] text-[14px] w-full">Browse real-time categorized logs of found keys, electronics, valuables, and accessories around the campus.</p>
    </div>
  );
}

function FeatureCard1() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_66px] flex-col gap-[16px] items-start min-w-px p-[32px] relative rounded-[12px]" data-name="FeatureCard">
      <div aria-hidden className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CardIcon1 />
      <CardContent1 />
    </div>
  );
}

function ShieldCheck() {
  return (
    <div className="relative shrink-0 size-[24px]" data-name="shield-check">
      <svg className="absolute block inset-0 size-full" fill="none" height="24" preserveAspectRatio="none" viewBox="0 0 24 24" width="24">
        <g id="shield-check">
          <path d={svgPaths.p26f66600} id="Vector" stroke="#1F3160" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function CardIcon2() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex flex-col items-center justify-center relative rounded-[8px] shrink-0 size-[48px]" data-name="CardIcon">
      <ShieldCheck />
    </div>
  );
}

function CardContent2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-start not-italic relative shrink-0 w-full" data-name="CardContent">
      <p className="font-['Inter:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#0f172a] text-[18px] w-full">Secure Pickup Verification</p>
      <p className="font-['Inter:Regular',sans-serif] font-normal leading-[22px] relative shrink-0 text-[#475569] text-[14px] w-full">Claimed items require verified student or employee ID and signature authentication upon pickup.</p>
    </div>
  );
}

function FeatureCard2() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_66px] flex-col gap-[16px] items-start min-w-px p-[32px] relative rounded-[12px]" data-name="FeatureCard">
      <div aria-hidden className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px]" />
      <CardIcon2 />
      <CardContent2 />
    </div>
  );
}

function FeaturesGrid() {
  return (
    <div className="content-stretch flex gap-[24px] items-start relative shrink-0 w-full" data-name="FeaturesGrid">
      <FeatureCard />
      <FeatureCard1 />
      <FeatureCard2 />
    </div>
  );
}

function FeaturesSection() {
  return (
    <div className="content-stretch flex flex-col gap-[40px] items-start p-[64px] relative shrink-0 w-full" data-name="FeaturesSection">
      <SectionHeader />
      <FeaturesGrid />
    </div>
  );
}

function SectionHeader1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-start leading-[normal] not-italic relative shrink-0 w-full" data-name="SectionHeader">
      <p className="font-['Inter:Bold',sans-serif] font-bold relative shrink-0 text-[#d1a153] text-[14px] uppercase whitespace-nowrap">REAL-TIME LOGS</p>
      <p className="font-['Inter:Extra_Bold',sans-serif] font-extrabold min-w-full relative shrink-0 text-[#0f172a] text-[28px] w-[min-content]">Recently Found Items</p>
    </div>
  );
}

function CategoryBadge() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[4px] shrink-0" data-name="CategoryBadge">
      <p className="[word-break:break-word] font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[normal] not-italic relative shrink-0 text-[#475569] text-[11px] uppercase whitespace-nowrap">Accessories</p>
    </div>
  );
}

function MapPin() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="map-pin">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g id="map-pin">
          <path d={svgPaths.p1b8a0e00} id="Vector" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function LocationRow() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0 w-full" data-name="LocationRow">
      <MapPin />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[normal] min-w-px not-italic overflow-hidden relative text-[#475569] text-[13px] text-ellipsis whitespace-nowrap">Main Building 3rd Floor</p>
    </div>
  );
}

function Calendar() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="calendar">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g clipPath="url(#clip0_0_5)" id="calendar">
          <path d={svgPaths.p38abe4f0} id="Vector" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_5">
            <rect fill="white" height="14" width="14" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function DateRow() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0 w-full" data-name="DateRow">
      <Calendar />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[normal] min-w-px not-italic relative text-[#475569] text-[13px]">Found Today</p>
    </div>
  );
}

function ItemMeta() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="ItemMeta">
      <p className="[word-break:break-word] font-['Inter:Bold',sans-serif] font-bold leading-[normal] not-italic overflow-hidden relative shrink-0 text-[#0f172a] text-[16px] text-ellipsis w-full whitespace-nowrap">Hydro Flask Flask</p>
      <LocationRow />
      <DateRow />
    </div>
  );
}

function CardDetails() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[20px] relative shrink-0 w-full" data-name="CardDetails">
      <CategoryBadge />
      <ItemMeta />
    </div>
  );
}

function ItemCard() {
  return (
    <div className="bg-white flex-[1_0_2px] min-w-px relative rounded-[12px]" data-name="ItemCard">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <div className="h-[180px] relative shrink-0 w-full" data-name="ItemImage">
          <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgItemImage} />
        </div>
        <CardDetails />
      </div>
      <div aria-hidden className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function CategoryBadge1() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[4px] shrink-0" data-name="CategoryBadge">
      <p className="[word-break:break-word] font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[normal] not-italic relative shrink-0 text-[#475569] text-[11px] uppercase whitespace-nowrap">Electronics</p>
    </div>
  );
}

function MapPin1() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="map-pin">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g id="map-pin">
          <path d={svgPaths.p1b8a0e00} id="Vector" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function LocationRow1() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0 w-full" data-name="LocationRow">
      <MapPin1 />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[normal] min-w-px not-italic overflow-hidden relative text-[#475569] text-[13px] text-ellipsis whitespace-nowrap">Admin Lobby Lounge</p>
    </div>
  );
}

function Calendar1() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="calendar">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g clipPath="url(#clip0_0_5)" id="calendar">
          <path d={svgPaths.p38abe4f0} id="Vector" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_5">
            <rect fill="white" height="14" width="14" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function DateRow1() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0 w-full" data-name="DateRow">
      <Calendar1 />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[normal] min-w-px not-italic relative text-[#475569] text-[13px]">Found Yesterday</p>
    </div>
  );
}

function ItemMeta1() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="ItemMeta">
      <p className="[word-break:break-word] font-['Inter:Bold',sans-serif] font-bold leading-[normal] not-italic overflow-hidden relative shrink-0 text-[#0f172a] text-[16px] text-ellipsis w-full whitespace-nowrap">iPhone 13 Pro</p>
      <LocationRow1 />
      <DateRow1 />
    </div>
  );
}

function CardDetails1() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[20px] relative shrink-0 w-full" data-name="CardDetails">
      <CategoryBadge1 />
      <ItemMeta1 />
    </div>
  );
}

function ItemCard1() {
  return (
    <div className="bg-white flex-[1_0_2px] min-w-px relative rounded-[12px]" data-name="ItemCard">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <div className="h-[180px] relative shrink-0 w-full" data-name="ItemImage">
          <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgItemImage1} />
        </div>
        <CardDetails1 />
      </div>
      <div aria-hidden className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function CategoryBadge2() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[4px] shrink-0" data-name="CategoryBadge">
      <p className="[word-break:break-word] font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[normal] not-italic relative shrink-0 text-[#475569] text-[11px] uppercase whitespace-nowrap">Personal Effects</p>
    </div>
  );
}

function MapPin2() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="map-pin">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g id="map-pin">
          <path d={svgPaths.p1b8a0e00} id="Vector" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function LocationRow2() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0 w-full" data-name="LocationRow">
      <MapPin2 />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[normal] min-w-px not-italic overflow-hidden relative text-[#475569] text-[13px] text-ellipsis whitespace-nowrap">UM Athletic Field</p>
    </div>
  );
}

function Calendar2() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="calendar">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g clipPath="url(#clip0_0_5)" id="calendar">
          <path d={svgPaths.p38abe4f0} id="Vector" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_5">
            <rect fill="white" height="14" width="14" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function DateRow2() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0 w-full" data-name="DateRow">
      <Calendar2 />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[normal] min-w-px not-italic relative text-[#475569] text-[13px]">Found Oct 24, 2026</p>
    </div>
  );
}

function ItemMeta2() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="ItemMeta">
      <p className="[word-break:break-word] font-['Inter:Bold',sans-serif] font-bold leading-[normal] not-italic overflow-hidden relative shrink-0 text-[#0f172a] text-[16px] text-ellipsis w-full whitespace-nowrap">Lanyard with Keys</p>
      <LocationRow2 />
      <DateRow2 />
    </div>
  );
}

function CardDetails2() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[20px] relative shrink-0 w-full" data-name="CardDetails">
      <CategoryBadge2 />
      <ItemMeta2 />
    </div>
  );
}

function ItemCard2() {
  return (
    <div className="bg-white flex-[1_0_2px] min-w-px relative rounded-[12px]" data-name="ItemCard">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <div className="h-[180px] relative shrink-0 w-full" data-name="ItemImage">
          <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgItemImage2} />
        </div>
        <CardDetails2 />
      </div>
      <div aria-hidden className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function CategoryBadge3() {
  return (
    <div className="bg-[#f1f5f9] content-stretch flex items-start px-[8px] py-[4px] relative rounded-[4px] shrink-0" data-name="CategoryBadge">
      <p className="[word-break:break-word] font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[normal] not-italic relative shrink-0 text-[#475569] text-[11px] uppercase whitespace-nowrap">Accessories</p>
    </div>
  );
}

function MapPin3() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="map-pin">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g id="map-pin">
          <path d={svgPaths.p1b8a0e00} id="Vector" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function LocationRow3() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0 w-full" data-name="LocationRow">
      <MapPin3 />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[normal] min-w-px not-italic overflow-hidden relative text-[#475569] text-[13px] text-ellipsis whitespace-nowrap">Library Study Area</p>
    </div>
  );
}

function Calendar3() {
  return (
    <div className="relative shrink-0 size-[14px]" data-name="calendar">
      <svg className="absolute block inset-0 size-full" fill="none" height="14" preserveAspectRatio="none" viewBox="0 0 14 14" width="14">
        <g clipPath="url(#clip0_0_5)" id="calendar">
          <path d={svgPaths.p38abe4f0} id="Vector" stroke="#475569" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_5">
            <rect fill="white" height="14" width="14" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function DateRow3() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0 w-full" data-name="DateRow">
      <Calendar3 />
      <p className="[word-break:break-word] flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[normal] min-w-px not-italic relative text-[#475569] text-[13px]">Found Oct 23, 2026</p>
    </div>
  );
}

function ItemMeta3() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-full" data-name="ItemMeta">
      <p className="[word-break:break-word] font-['Inter:Bold',sans-serif] font-bold leading-[normal] not-italic overflow-hidden relative shrink-0 text-[#0f172a] text-[16px] text-ellipsis w-full whitespace-nowrap">Black Umbrella</p>
      <LocationRow3 />
      <DateRow3 />
    </div>
  );
}

function CardDetails3() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[20px] relative shrink-0 w-full" data-name="CardDetails">
      <CategoryBadge3 />
      <ItemMeta3 />
    </div>
  );
}

function ItemCard3() {
  return (
    <div className="bg-white flex-[1_0_2px] min-w-px relative rounded-[12px]" data-name="ItemCard">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <div className="h-[180px] relative shrink-0 w-full" data-name="ItemImage">
          <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgItemImage3} />
        </div>
        <CardDetails3 />
      </div>
      <div aria-hidden className="absolute border border-[#e2e8f0] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function ItemsGrid() {
  return (
    <div className="content-stretch flex gap-[24px] items-start relative shrink-0 w-full" data-name="ItemsGrid">
      <ItemCard />
      <ItemCard1 />
      <ItemCard2 />
      <ItemCard3 />
    </div>
  );
}

function RecentItemsSection() {
  return (
    <div className="content-stretch flex flex-col gap-[32px] items-start pb-[80px] px-[64px] relative shrink-0 w-full" data-name="RecentItemsSection">
      <SectionHeader1 />
      <ItemsGrid />
    </div>
  );
}

function FooterBranding() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0" data-name="FooterBranding">
      <p className="font-['Inter:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-white">{`E-BALIK lost & found system`}</p>
      <p className="font-['Inter:Regular',sans-serif] font-normal relative shrink-0 text-[#d1a153] text-[14px]">University of Makati — Administrative Office</p>
    </div>
  );
}

function Links() {
  return (
    <div className="content-stretch flex font-['Inter:Regular',sans-serif] font-normal gap-[24px] items-start relative shrink-0 text-[14px] text-white" data-name="Links">
      <p className="relative shrink-0">Privacy Policy</p>
      <p className="relative shrink-0">Terms of Service</p>
      <p className="relative shrink-0">Contact Support</p>
    </div>
  );
}

function FooterContent() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] not-italic relative shrink-0 w-full whitespace-nowrap" data-name="FooterContent">
      <FooterBranding />
      <Links />
    </div>
  );
}

function Footer() {
  return (
    <div className="bg-[#1f3160] content-stretch flex flex-col gap-[24px] items-start px-[64px] py-[48px] relative shrink-0 w-full" data-name="Footer">
      <div aria-hidden className="absolute border border-[#d1a153] border-solid inset-0 pointer-events-none" />
      <FooterContent />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 1312 1" width="1312">
            <line id="Line" stroke="white" strokeOpacity="0.2" x2="1312" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <p className="[word-break:break-word] font-['Inter:Regular',sans-serif] font-normal leading-[normal] not-italic relative shrink-0 text-[13px] text-[rgba(255,255,255,0.53)] w-full">© 2026 University of Makati. All rights reserved. Registered trademark of UM Administrative Systems.</p>
    </div>
  );
}

export default function HomepageContent() {
  return (
    <div className="bg-[#f8fafc] content-stretch flex flex-col items-start relative size-full" data-name="HomepageContent">
      <HeroSection />
      <FeaturesSection />
      <RecentItemsSection />
      <Footer />
    </div>
  );
}