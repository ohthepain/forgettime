Pod::Spec.new do |s|
  s.name = 'ForgettimeAudio'
  s.version = '0.1.0'
  s.summary = 'Sample-timestamped foreground drum onset capture'
  s.license = { :type => 'MIT' }
  s.homepage = 'https://github.com/ohthepain/forgettime'
  s.author = 'Forgettime'
  s.source = { :git => 'https://github.com/ohthepain/forgettime.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/ForgettimeAudioPlugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
