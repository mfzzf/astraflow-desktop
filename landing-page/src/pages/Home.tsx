import Navbar from '@/sections/Navbar'
import Hero from '@/sections/Hero'
import ProductPreview from '@/sections/ProductPreview'
import Features from '@/sections/Features'
import DownloadSection from '@/sections/DownloadSection'
import Faq from '@/sections/Faq'
import Footer from '@/sections/Footer'

export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 antialiased">
      <Navbar />
      <main>
        <Hero />
        <ProductPreview />
        <Features />
        <DownloadSection />
        <Faq />
      </main>
      <Footer />
    </div>
  )
}
