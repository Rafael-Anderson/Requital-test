// Static offline fallback for the breached-password check: always applies,
// needs no network, cannot be disabled by the env switch. Lowercased, and only
// entries of 8+ characters (anything shorter already fails the length rule).
// A deliberately small list of the most-used passwords and obvious keyboard /
// brand / season patterns; the HIBP range check (breach-check.ts) is the
// broad net, this is the floor that survives that service being down.
const RAW = `
password password1 password12 password123 password1234 password12345 password123456 password1! password! passw0rd
passw0rd1 p@ssw0rd p@ssword p@ssw0rd1 pa$$word pa55word pa55w0rd password01 password02 password2 password3 password99
password11 password22 password321 password007 mypassword mypassword1 mypassword123 myp@ssw0rd newpassword newpassword1
newpassword123 oldpassword letmein123 letmein1 letmein12 letmein! letmeinnow welcome1 welcome12 welcome123 welcome1234
welcome! welcome@123 welcome#1 admin123 admin1234 admin12345 admin@123 admin@1234 administrator admin1234567 adminadmin
admin1admin root1234 rootroot toor1234 qwerty12 qwerty123 qwerty1234 qwerty12345 qwerty123456 qwertyui qwertyuiop
qwertyuiop123 qwerty1! qwerty@123 qwerty!@# qwertyasdf qazwsxedc qazwsx123 qazwsx12 1qaz2wsx 1qaz2wsx3edc 1q2w3e4r
1q2w3e4r5t 1q2w3e4r5t6y 1qazxsw2 zaq12wsx zxcvbnm1 zxcvbnm123 zxcvbnm! zxcvbnm, asdfghjk asdfghjkl asdfghjkl1
asdf1234 asdf12345 asdfasdf asdf@123 asdfgh123 asdfghjk123 123qweasd 123qwe123 123qweasdzxc 12345678 123456789
1234567890 12345678910 123456789a 123456789! 12345678a 12345678! 1234qwer 1234qwer! 12341234 123123123 1231231234
12344321 123454321 1234554321 12345679 123456a! 123abc123 abc12345 abc123456 abcd1234 abcd12345 abcd123456 abcdefgh
abcdefgh1 abcdefg1 abcdefghi abcdefghij abc12345! abcabc123 aaaaaaaa aaaaaaa1 aaaa1111 aaaaaaaaa bbbbbbbb cccccccc
dddddddd 11111111 111111111 1111111111 11112222 11223344 112233445566 22222222 33333333 44444444 55555555 66666666
77777777 88888888 99999999 00000000 000000000 0000000000 00001111 01234567 012345678 0123456789 87654321 987654321
9876543210 98765432 9876543 76543210 654321654321 1qaz1qaz iloveyou iloveyou1 iloveyou2 iloveyou123 iloveyou!
iloveu123 iloveyou12 ilovemom ilovedad ilovegod ilovelove iloveyoutoo loveyou1 loveyou123 lovelove love1234 love12345
lovely123 lover123 sunshine sunshine1 sunshine123 princess princess1 princess123 princesa princess12 babygirl babygirl1
babygirl123 football football1 football123 baseball baseball1 basketball soccer123 hockey123 monkey123 monkey12
monkey1234 dragon123 dragon12 dragon1234 master123 master12 masterkey mustang1 mustang123 shadow123 shadow12 superman
superman1 superman123 batman123 batman12 batman1234 spiderman spiderman1 trustno1 trustno123 whatever whatever1
whatever123 starwars starwars1 starwars123 pokemon123 pokemon1 changeme changeme1 changeme123 changeit changeme! 
default123 default1234 test1234 test12345 test123456 testtest testtest1 testing123 testing1 test@123 test@1234 tester123
guest123 guest1234 user1234 user12345 username username1 login123 login1234 loginlogin secret123 secret12 secret1234
secretpassword supersecret superpassword super123 hello123 hello1234 hello12345 helloworld hello@123 helloworld1
helloworld123 freedom1 freedom123 charlie1 charlie123 michael1 michael123 jordan23 jordan123 jennifer1 jessica1 jessica123
daniel123 andrew123 matthew1 thomas123 robert123 ashley123 nicole123 hunter123 hunter12 hunter2 hunter1234 cookie123
cookie12 buster123 summer123 summer2020 summer2021 summer2022 summer2023 summer2024 summer2025 summer2026 winter123
winter2020 winter2021 winter2022 winter2023 winter2024 winter2025 winter2026 spring2024 spring2025 spring2026 autumn2024
autumn2025 autumn2026 january1 february1 monday123 friday123 sunday123 pass1234 pass12345 pass123456 pass@123 pass@1234
passpass passpass1 passcode1 passcode123 passphrase password. password@ password@1 password@123 password#1 password$1
passwort passwort1 passwort123 motdepasse contrasena1 contrasena123 senha123 senha1234 parola123 salasana
matkhau123 parolamea kennwort1 wachtwort1 lozinka123 heslo123 haslo123 hasl0123 marhaba123 marhaba1 habibi123
habibi1234 alhabibi allahuakbar bismillah bismillah1 inshallah mohammed1 mohammed123 mohamed123 ahmed1234 ahmed12345
ahmed123456 fatima123 khalid123 abdullah1 abdullah123 saudi123 saudi1234 dubai123 dubai1234 dubai12345 dubai2020
dubai2024 dubai2025 dubai2026 uae12345 uae123456 abudhabi1 sharjah123 emirates1 emirates123 arabic123 flowers123
florist123 florist1234 flowers1234 flowers1 bouquet123 gift12345 giftshop1 giftshop123 shop1234 shop12345 shop123456
shopadmin shopadmin1 shopadmin123 myshop123 myshop1234 mystore123 mystore1234 store1234 store12345 storeadmin
storeadmin1 merchant1 merchant123 merchant1234 seller123 seller1234 business1 business123 company1 company123
requital requital1 requital123 requital1234 requital12345 requital@123 requital2024 requital2025 requital2026
google123 google1234 facebook1 facebook123 instagram1 instagram123 whatsapp1 whatsapp123 snapchat1 youtube123
amazon123 apple1234 apple12345 iphone123 iphone1234 samsung123 microsoft1 windows123 windows10 linux1234 ubuntu123
computer computer1 computer123 internet internet1 internet123 mypassw0rd mypass123 mypass1234 mypass12345 passme123
trustme123 letmein2 access123 access1234 access14 accessgranted opensesame opensesame1 sesame123 entrance1 master1234
mastermaster killer123 killer1234 ninja123 ninja1234 pirate123 hacker123 hacker1234 hackme123 iamadmin iamtheadmin
iloveadmin
`;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  RAW.split(/\s+/).filter((w) => w.length >= 8),
);
