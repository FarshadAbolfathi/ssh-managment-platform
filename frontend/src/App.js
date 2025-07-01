import React, { useState, useEffect } from 'react';
import { Server, Shield, Users, Settings, CheckCircle, AlertCircle, Loader, Globe, CreditCard } from 'lucide-react';
import './index.css';

const SSHPanelInstaller = () => {
  const [language, setLanguage] = useState('fa');
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installStatus, setInstallStatus] = useState('');
  const [userTier, setUserTier] = useState('free'); // free, premium, enterprise

  const [serverData, setServerData] = useState({
    serverIP: '',
    sshUsername: '',
    sshPassword: '',
    sshPort: '22',
    panelUsername: '',
    panelPassword: '',
    installPath: '/var/www/html/panel'
  });

  const translations = {
    fa: {
      title: 'نصب کننده پنل مدیریت SSH',
      subtitle: 'نصب آسان پنل مدیریت کاربران SSH روی سرور شما',
      serverInfo: 'اطلاعات سرور',
      serverIP: 'آدرس IP سرور',
      sshUsername: 'نام کاربری SSH',
      sshPassword: 'رمز عبور SSH',
      sshPort: 'پورت SSH',
      panelConfig: 'تنظیمات پنل',
      panelUsername: 'نام کاربری پنل',
      panelPassword: 'رمز عبور پنل',
      installPath: 'مسیر نصب',
      testConnection: 'تست اتصال',
      install: 'شروع نصب',
      installing: 'در حال نصب...',
      success: 'نصب موفقیت آمیز',
      error: 'خطا در نصب',
      connecting: 'اتصال به سرور...',
      uploadingFiles: 'آپلود فایل‌ها...',
      configuringServer: 'پیکربندی سرور...',
      settingUpDatabase: 'راه‌اندازی پایگاه داده...',
      finalizing: 'تکمیل نصب...',
      panelUrl: 'آدرس پنل شما',
      visitPanel: 'ورود به پنل',
      upgrade: 'ارتقا حساب',
      features: 'ویژگی‌ها',
      freeFeatures: ['تا 10 کاربر SSH', 'مدیریت پایه', 'پشتیبانی محدود'],
      premiumFeatures: ['کاربران نامحدود', 'گزارش‌گیری پیشرفته', 'پشتیبانی اولویت‌دار', 'API Access'],
      enterpriseFeatures: ['چند سرور', 'SSO Integration', 'پشتیبانی 24/7', 'کاستوم برندینگ']
    },
    en: {
      title: 'SSH Management Panel Installer',
      subtitle: 'Easy installation of SSH user management panel on your server',
      serverInfo: 'Server Information',
      serverIP: 'Server IP Address',
      sshUsername: 'SSH Username',
      sshPassword: 'SSH Password',
      sshPort: 'SSH Port',
      panelConfig: 'Panel Configuration',
      panelUsername: 'Panel Username',
      panelPassword: 'Panel Password',
      installPath: 'Installation Path',
      testConnection: 'Test Connection',
      install: 'Start Installation',
      installing: 'Installing...',
      success: 'Installation Successful',
      error: 'Installation Error',
      connecting: 'Connecting to server...',
      uploadingFiles: 'Uploading files...',
      configuringServer: 'Configuring server...',
      settingUpDatabase: 'Setting up database...',
      finalizing: 'Finalizing installation...',
      panelUrl: 'Your Panel URL',
      visitPanel: 'Visit Panel',
      upgrade: 'Upgrade Account',
      features: 'Features',
      freeFeatures: ['Up to 10 SSH users', 'Basic management', 'Limited support'],
      premiumFeatures: ['Unlimited users', 'Advanced reporting', 'Priority support', 'API Access'],
      enterpriseFeatures: ['Multi-server', 'SSO Integration', '24/7 Support', 'Custom branding']
    }
  };

  const t = translations[language];

  const steps = [
    { id: 1, title: t.serverInfo, icon: Server },
    { id: 2, title: t.panelConfig, icon: Settings },
    { id: 3, title: 'Installation', icon: Loader }
  ];

  const handleInputChange = (field, value) => {
    setServerData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const testConnection = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:4000/api/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 'Authorization': `Bearer ${YOUR_AUTH_TOKEN}` // Add this if you have auth
        },
        body: JSON.stringify(serverData)
      });
      const data = await response.json();
      if (data.success) {
        alert('Connection successful! / اتصال موفقیت آمیز!');
      } else {
        alert(`Connection failed: ${data.message}`);
      }
    } catch (error) {
      alert(`Connection error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const startInstallation = async () => {
    setCurrentStep(3);
    setLoading(true);

    try {
      const response = await fetch('http://localhost:4000/api/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 'Authorization': `Bearer ${YOUR_AUTH_TOKEN}` // Add this if you have auth
        },
        body: JSON.stringify({
          serverData: serverData,
          panelConfig: {
            panelUsername: serverData.panelUsername,
            panelPassword: serverData.panelPassword,
            installPath: serverData.installPath
          }
        })
      });

      const data = await response.json();
      if (data.success) {
        const installKey = data.installKey;
        const interval = setInterval(async () => {
          const statusResponse = await fetch(`http://localhost:4000/api/installation/${installKey}`, {
            headers: {
              // 'Authorization': `Bearer ${YOUR_AUTH_TOKEN}` // Add this if you have auth
            }
          });
          const statusData = await statusResponse.json();
          if (statusData.success) {
            setInstallProgress(statusData.installation.progress);
            setInstallStatus(statusData.logs.length > 0 ? statusData.logs[0].message : 'در حال نصب...');
            if (statusData.installation.status === 'completed' || statusData.installation.status === 'failed') {
              clearInterval(interval);
              setLoading(false);
              setInstallStatus(statusData.installation.status === 'completed' ? t.success : t.error);
            }
          }
        }, 3000);
      } else {
        alert(`Installation failed to start: ${data.message}`);
        setLoading(false);
      }
    } catch (error) {
      alert(`Installation error: ${error.message}`);
      setLoading(false);
    }
  };

  const PricingCard = ({ tier, price, features, current = false }) => (
    <div className={`border-2 rounded-lg p-6 ${current ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
      <div className="text-center mb-4">
        <h3 className="text-xl font-bold capitalize">{tier}</h3>
        <div className="text-3xl font-bold text-blue-600">{price}</div>
      </div>
      <ul className="space-y-2 mb-6">
        {features.map((feature, index) => (
          <li key={index} className="flex items-center">
            <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
            <span className="text-sm">{feature}</span>
          </li>
        ))}
      </ul>
      {!current && (
        <button className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors">
          {t.upgrade}
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-blue-800">{t.title}</h1>
              <p className="text-gray-600 mt-2">{t.subtitle}</p>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setLanguage(language === 'fa' ? 'en' : 'fa')}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-100 rounded-lg hover:bg-blue-200 transition-colors"
              >
                <Globe className="w-4 h-4" />
                <span>{language === 'fa' ? 'EN' : 'فا'}</span>
              </button>
              <div className="flex items-center space-x-2 text-sm">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <span className="capitalize font-medium">{userTier}</span>
              </div>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-center space-x-8 mb-8">
            {steps.map(step => {
              const IconComponent = step.icon;
              const isActive = currentStep === step.id;
              const isComplete = currentStep > step.id;
              
              return (
                <div key={step.id} className="flex items-center">
                  <div className={`flex items-center justify-center w-12 h-12 rounded-full ${
                    isComplete ? 'bg-green-500 text-white' : 
                    isActive ? 'bg-blue-600 text-white' : 
                    'bg-gray-200 text-gray-500'
                  }`}>
                    {isComplete ? <CheckCircle className="w-6 h-6" /> : <IconComponent className="w-6 h-6" />}
                  </div>
                  <span className={`ml-3 font-medium ${isActive ? 'text-blue-600' : 'text-gray-500'}`}>
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          {currentStep === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-blue-800 mb-6">{t.serverInfo}</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.serverIP}
                  </label>
                  <input
                    type="text"
                    value={serverData.serverIP}
                    onChange={(e) => handleInputChange('serverIP', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="192.168.1.100"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.sshPort}
                  </label>
                  <input
                    type="text"
                    value={serverData.sshPort}
                    onChange={(e) => handleInputChange('sshPort', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="22"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.sshUsername}
                  </label>
                  <input
                    type="text"
                    value={serverData.sshUsername}
                    onChange={(e) => handleInputChange('sshUsername', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="root"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.sshPassword}
                  </label>
                  <input
                    type="password"
                    value={serverData.sshPassword}
                    onChange={(e) => handleInputChange('sshPassword', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex space-x-4">
                <button
                  onClick={testConnection}
                  disabled={loading}
                  className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                  <span>{t.testConnection}</span>
                </button>
                
                <button
                  onClick={() => setCurrentStep(2)}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-blue-800 mb-6">{t.panelConfig}</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.panelUsername}
                  </label>
                  <input
                    type="text"
                    value={serverData.panelUsername}
                    onChange={(e) => handleInputChange('panelUsername', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="admin"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.panelPassword}
                  </label>
                  <input
                    type="password"
                    value={serverData.panelPassword}
                    onChange={(e) => handleInputChange('panelPassword', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.installPath}
                  </label>
                  <input
                    type="text"
                    value={serverData.installPath}
                    onChange={(e) => handleInputChange('installPath', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Pricing Plans */}
              <div className="mt-8">
                <h3 className="text-xl font-bold text-gray-800 mb-6 text-center">{t.features}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <PricingCard 
                    tier="free" 
                    price="$0" 
                    features={t.freeFeatures}
                    current={userTier === 'free'}
                  />
                  <PricingCard 
                    tier="premium" 
                    price="$19/mo" 
                    features={t.premiumFeatures}
                    current={userTier === 'premium'}
                  />
                  <PricingCard 
                    tier="enterprise" 
                    price="$49/mo" 
                    features={t.enterpriseFeatures}
                    current={userTier === 'enterprise'}
                  />
                </div>
              </div>

              <div className="flex space-x-4">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  ← Back
                </button>
                
                <button
                  onClick={startInstallation}
                  className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  <span>{t.install}</span>
                </button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="text-center space-y-6">
              <h2 className="text-2xl font-bold text-blue-800">{loading ? t.installing : t.success}</h2>
              
              {loading ? (
                <div className="space-y-4">
                  <Loader className="w-12 h-12 animate-spin text-blue-600 mx-auto" />
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${installProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-gray-600">{installStatus}</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-800 font-medium">{t.panelUrl}:</p>
                    <p className="text-green-600 text-lg font-mono">
                      http://{serverData.serverIP}/panel
                    </p>
                  </div>
                  <button
                    onClick={() => window.open(`http://${serverData.serverIP}/panel`, '_blank')}
                    className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Server className="w-4 h-4" />
                    <span>{t.visitPanel}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SSHPanelInstaller;