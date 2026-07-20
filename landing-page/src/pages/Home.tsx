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
        <Hero />
        <TrustMarquee />
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
