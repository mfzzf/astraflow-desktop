import Navbar from '@/sections/Navbar'
import Hero from '@/sections/Hero'
import TrustMarquee from '@/sections/TrustMarquee'
import ProductPreview from '@/sections/ProductPreview'
import Features from '@/sections/Features'
import DownloadSection from '@/sections/DownloadSection'
import Faq from '@/sections/Faq'
import FinalCta from '@/sections/FinalCta'
import Footer from '@/sections/Footer'

export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 antialiased">
      <Navbar />
      <main>
        {/* 首屏渐变区：Hero 与生态跑马灯共享同一片梦境渐变 */}
        <div className="mesh-hero">
          <Hero />
          <TrustMarquee />
        </div>
        <ProductPreview />
        <Features />
        <DownloadSection />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
